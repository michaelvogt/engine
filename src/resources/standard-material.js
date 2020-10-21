import { PIXELFORMAT_R8_G8_B8_A8 } from '../graphics/graphics.js';
import { Texture } from '../graphics/texture.js';

import { SPECULAR_PHONG } from '../scene/constants.js';
import { standardMaterialCubemapParameters, standardMaterialTextureParameters } from '../scene/materials/standard-material-parameters.js';

import { AssetReference } from '../asset/asset-reference.js';

var PLACEHOLDER_MAP = {
    aoMap: 'white',
    diffuseMap: 'gray',
    specularMap: 'gray',
    metalnessMap: 'black',
    glossMap: 'gray',
    emissiveMap: 'gray',
    normalMap: 'normal',
    heightMap: 'gray',
    opacityMap: 'gray',
    sphereMap: 'gray',
    lightMap: 'white'
};

/**
 * @class
 * @name pc.StandardMaterialBinder
 * @classdesc Resource binder used for binding {@link pc.StandardMaterial} resources.
 * @param {pc.Application} app - The running {@link pc.Application}.
 * @param {pc.JsonStandardMaterialParser} parser - JSON parser for {@link pc.StandardMaterial} owned by global {@link pc.MaterialHandler}
 */
function StandardMaterialBinder(app, parser) {
    this._assets = app.assets;
    this._device = app.graphicsDevice;
    this._parser = parser;

    this._placeholderTextures = null;
}

Object.assign(StandardMaterialBinder.prototype, {

    // creates placeholders for textures
    // that are used while texture is loading
    _createPlaceholders: function () {
        this._placeholderTextures = {};

        var textures = {
            white: [255, 255, 255, 255],
            gray: [128, 128, 128, 255],
            black: [0, 0, 0, 255],
            normal: [128, 128, 255, 255]
        };

        for (var key in textures) {
            if (!textures.hasOwnProperty(key))
                continue;

            // create texture
            this._placeholderTextures[key] = new Texture(this._device, {
                width: 2,
                height: 2,
                format: PIXELFORMAT_R8_G8_B8_A8
            });
            this._placeholderTextures[key].name = 'placeholder';

            // fill pixels with color
            var pixels = this._placeholderTextures[key].lock();
            for (var i = 0; i < 4; i++) {
                for (var c = 0; c < 4; c++) {
                    pixels[i * 4 + c] = textures[key][c];
                }
            }
            this._placeholderTextures[key].unlock();
        }
    },

    onAssetUnload: function (asset) {
        // remove the parameter block we created which includes texture references
        delete asset.data.parameters;
        delete asset.data.chunks;
        delete asset.data.name;
    },

    _assignTexture: function (parameterName, materialAsset, texture) {
        materialAsset.data[parameterName] = texture;
        materialAsset.resource[parameterName] = texture;
    },

    // assign a placeholder texture while waiting for one to load
    // placeholder textures do not replace the data[parameterName] value
    // in the asset.data thus preserving the final asset id until it is loaded
    _assignPlaceholderTexture: function (parameterName, materialAsset) {
        // create placeholder textures on-demand
        if (!this._placeholderTextures) {
            this._createPlaceholders();
        }

        var placeholder = PLACEHOLDER_MAP[parameterName];
        var texture = this._placeholderTextures[placeholder];

        materialAsset.resource[parameterName] = texture;
    },

    _onTextureLoad: function (parameterName, materialAsset, textureAsset) {
        this._assignTexture(parameterName, materialAsset, textureAsset.resource);
        materialAsset.resource.update();
    },

    _onTextureAdd: function (parameterName, materialAsset, textureAsset) {
        this._assets.load(textureAsset);
    },

    _onTextureRemove: function (parameterName, materialAsset, textureAsset) {
        var material = materialAsset.resource;

        if (material[parameterName] === textureAsset.resource) {
            this._assignTexture(parameterName, materialAsset, null);
            material.update();
        }
    },

    _assignCubemap: function (parameterName, materialAsset, textures) {
        materialAsset.data[parameterName] = textures[0]; // the primary cubemap texture
        if (textures.length === 7) {
            // the prefiltered textures
            materialAsset.data.prefilteredCubeMap128 = textures[1];
            materialAsset.data.prefilteredCubeMap64 = textures[2];
            materialAsset.data.prefilteredCubeMap32 = textures[3];
            materialAsset.data.prefilteredCubeMap16 = textures[4];
            materialAsset.data.prefilteredCubeMap8 = textures[5];
            materialAsset.data.prefilteredCubeMap4 = textures[6];
        }
    },

    _onCubemapLoad: function (parameterName, materialAsset, cubemapAsset) {
        this._assignCubemap(parameterName, materialAsset, cubemapAsset.resources);
        this._parser.initialize(materialAsset.resource, materialAsset.data);
    },

    _onCubemapAdd: function (parameterName, materialAsset, cubemapAsset) {
        // phong based - so ensure we load individual faces
        if (materialAsset.data.shadingModel === SPECULAR_PHONG) {
            materialAsset.loadFaces = true;
        }

        this._assets.load(cubemapAsset);
    },


    _onCubemapRemove: function (parameterName, materialAsset, cubemapAsset) {
        var material = materialAsset.resource;

        if (material[parameterName] === cubemapAsset.resource) {
            this._assignCubemap(parameterName, materialAsset, [null, null, null, null, null, null, null]);
            material.update();
        }
    },

    bindAndAssignAssets: function (materialAsset, assets) {
        // always migrate before updating material from asset data
        var data = this._parser.migrate(materialAsset.data);

        var material = materialAsset.resource;

        var pathMapping = (data.mappingFormat === "path");

        var TEXTURES = standardMaterialTextureParameters;

        var i, name, assetReference;
        // iterate through all texture parameters
        for (i = 0; i < TEXTURES.length; i++) {
            name = TEXTURES[i];

            assetReference = material._assetReferences[name];

            // data[name] contains an asset id for a texture
            if (data[name] && !(data[name] instanceof Texture)) {
                if (!assetReference) {
                    assetReference = new AssetReference(name, materialAsset, assets, {
                        load: this._onTextureLoad,
                        add: this._onTextureAdd,
                        remove: this._onTextureRemove
                    }, this);

                    material._assetReferences[name] = assetReference;
                }

                if (pathMapping) {
                    // texture paths are measured from the material directory
                    assetReference.url = materialAsset.getAbsoluteUrl(data[name]);
                } else {
                    assetReference.id = data[name];
                }

                if (assetReference.asset) {
                    if (assetReference.asset.resource) {
                        // asset is already loaded
                        this._assignTexture(name, materialAsset, assetReference.asset.resource);
                    } else {
                        this._assignPlaceholderTexture(name, materialAsset);
                    }

                    assets.load(assetReference.asset);
                }
            } else {
                if (assetReference) {
                    // texture has been removed
                    if (pathMapping) {
                        assetReference.url = null;
                    } else {
                        assetReference.id = null;
                    }
                } else {
                    // no asset reference and no data field
                    // do nothing
                }
            }
        }

        var CUBEMAPS = standardMaterialCubemapParameters;

        // iterate through all cubemap parameters
        for (i = 0; i < CUBEMAPS.length; i++) {
            name = CUBEMAPS[i];

            assetReference = material._assetReferences[name];

            // data[name] contains an asset id for a cubemap
            if (data[name] && !(data[name] instanceof Texture)) {
                if (!assetReference) {
                    assetReference = new AssetReference(name, materialAsset, assets, {
                        load: this._onCubemapLoad,
                        add: this._onCubemapAdd,
                        remove: this._onCubemapRemove
                    }, this);

                    material._assetReferences[name] = assetReference;
                }

                if (pathMapping) {
                    assetReference.url = data[name];
                } else {
                    assetReference.id = data[name];
                }

                if (assetReference.asset) {
                    if (assetReference.asset.loaded) {
                        // asset loaded
                        this._assignCubemap(name, materialAsset, assetReference.asset.resources);
                    }

                    assets.load(assetReference.asset);
                }
            }


        }

        // call to re-initialize material after all textures assigned
        this._parser.initialize(material, data);
    }
});

export { StandardMaterialBinder };