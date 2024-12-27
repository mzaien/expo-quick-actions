"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const image_utils_1 = require("@expo/image-utils");
const config_plugins_1 = require("@expo/config-plugins");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// @ts-ignore
const pbxFile_1 = __importDefault(require("xcode/lib/pbxFile"));
const withAndroidDynamicAppIcon_1 = require("./withAndroidDynamicAppIcon");
/** The default icon folder name to export to */
const ICON_FOLDER_NAME = "DynamicAppIcons";
/**
 * The default icon dimensions to export.
 *
 * @see https://developer.apple.com/design/human-interface-guidelines/app-icons#iOS-iPadOS-app-icon-sizes
 */
const ICON_DIMENSIONS = [
    // iPhone, iPad, MacOS, ...
    { scale: 2, size: 60 },
    { scale: 3, size: 60 },
    // iPad only
    { scale: 2, size: 60, width: 152, height: 152, target: "ipad" },
    { scale: 3, size: 60, width: 167, height: 167, target: "ipad" },
];
const withDynamicIcon = (config, props = {}) => {
    const icons = resolveIcons(props);
    const dimensions = resolveIconDimensions(config);
    // TODO: More sensible android options and some way to add platform specific icons.
    (0, withAndroidDynamicAppIcon_1.withAndroidDynamicAppIcons)(config, {
        icons: Object.fromEntries(Object.entries(icons).map(([key, value]) => [key, value.image])),
    });
    config = withIconXcodeProject(config, { icons, dimensions });
    config = withIconInfoPlist(config, { icons, dimensions });
    config = withIconImages(config, { icons, dimensions });
    return config;
};
const withIconXcodeProject = (config, { icons, dimensions }) => {
    return (0, config_plugins_1.withXcodeProject)(config, async (config) => {
        const groupPath = `${config.modRequest.projectName}/${ICON_FOLDER_NAME}`;
        const group = config_plugins_1.IOSConfig.XcodeUtils.ensureGroupRecursively(config.modResults, groupPath);
        const project = config.modResults;
        const opt = {};
        // Unlink old assets
        const groupId = Object.keys(project.hash.project.objects["PBXGroup"]).find((id) => {
            const _group = project.hash.project.objects["PBXGroup"][id];
            return _group.name === group.name;
        });
        if (!project.hash.project.objects["PBXVariantGroup"]) {
            project.hash.project.objects["PBXVariantGroup"] = {};
        }
        const variantGroupId = Object.keys(project.hash.project.objects["PBXVariantGroup"]).find((id) => {
            const _group = project.hash.project.objects["PBXVariantGroup"][id];
            return _group.name === group.name;
        });
        const children = [...(group.children || [])];
        for (const child of children) {
            const file = new pbxFile_1.default(path_1.default.join(group.name, child.comment), opt);
            file.target = opt ? opt.target : undefined;
            project.removeFromPbxBuildFileSection(file); // PBXBuildFile
            project.removeFromPbxFileReferenceSection(file); // PBXFileReference
            if (group) {
                if (groupId) {
                    project.removeFromPbxGroup(file, groupId); //Group other than Resources (i.e. 'splash')
                }
                else if (variantGroupId) {
                    project.removeFromPbxVariantGroup(file, variantGroupId); // PBXVariantGroup
                }
            }
            project.removeFromPbxResourcesBuildPhase(file); // PBXResourcesBuildPhase
        }
        // Link new assets
        await iterateIconsAndDimensionsAsync({ icons, dimensions }, async (key, { dimension }) => {
            const iconFileName = getIconFileName(key, dimension);
            if (!group?.children.some(({ comment }) => comment === iconFileName)) {
                // Only write the file if it doesn't already exist.
                config.modResults = config_plugins_1.IOSConfig.XcodeUtils.addResourceFileToGroup({
                    filepath: path_1.default.join(groupPath, iconFileName),
                    groupName: groupPath,
                    project: config.modResults,
                    isBuildFile: true,
                    verbose: true,
                });
            }
            else {
                console.log("Skipping duplicate: ", iconFileName);
            }
        });
        return config;
    });
};
const withIconInfoPlist = (config, { icons, dimensions }) => {
    return (0, config_plugins_1.withInfoPlist)(config, async (config) => {
        const altIcons = {};
        const altIconsByTarget = {};
        await iterateIconsAndDimensionsAsync({ icons, dimensions }, async (key, { icon, dimension }) => {
            const plistItem = {
                CFBundleIconFiles: [
                    // Must be a file path relative to the source root (not a icon set it seems).
                    // i.e. `Bacon-Icon-60x60` when the image is `ios/somn/appIcons/Bacon-Icon-60x60@2x.png`
                    getIconName(key, dimension),
                ],
                UIPrerenderedIcon: !!icon.prerendered,
            };
            if (dimension.target) {
                altIconsByTarget[dimension.target] =
                    altIconsByTarget[dimension.target] || {};
                altIconsByTarget[dimension.target][key] = plistItem;
            }
            else {
                altIcons[key] = plistItem;
            }
        });
        function applyToPlist(key, icons) {
            if (typeof config.modResults[key] !== "object" ||
                Array.isArray(config.modResults[key]) ||
                !config.modResults[key]) {
                config.modResults[key] = {};
            }
            // @ts-ignore
            config.modResults[key].CFBundleAlternateIcons = icons;
            // @ts-ignore
            config.modResults[key].CFBundlePrimaryIcon = {
                CFBundleIconFiles: ["AppIcon"],
            };
        }
        // Apply for general phone support
        applyToPlist("CFBundleIcons", altIcons);
        // Apply for each target, like iPad
        for (const [target, icons] of Object.entries(altIconsByTarget)) {
            if (Object.keys(icons).length > 0) {
                applyToPlist(`CFBundleIcons~${target}`, icons);
            }
        }
        return config;
    });
};
const withIconImages = (config, { icons, dimensions }) => {
    return (0, config_plugins_1.withDangerousMod)(config, [
        "ios",
        async (config) => {
            const iosRoot = path_1.default.join(config.modRequest.platformProjectRoot, config.modRequest.projectName);
            // Delete all existing assets
            await fs_1.default.promises
                .rm(path_1.default.join(iosRoot, ICON_FOLDER_NAME), {
                recursive: true,
                force: true,
            })
                .catch(() => null);
            // Ensure directory exists
            await fs_1.default.promises.mkdir(path_1.default.join(iosRoot, ICON_FOLDER_NAME), {
                recursive: true,
            });
            // Generate new assets
            await iterateIconsAndDimensionsAsync({ icons, dimensions }, async (key, { icon, dimension }) => {
                const iconFileName = getIconFileName(key, dimension);
                const fileName = path_1.default.join(ICON_FOLDER_NAME, iconFileName);
                const outputPath = path_1.default.join(iosRoot, fileName);
                const { source } = await (0, image_utils_1.generateImageAsync)({
                    projectRoot: config.modRequest.projectRoot,
                    cacheType: "react-native-dynamic-app-icon",
                }, {
                    name: iconFileName,
                    src: icon.image,
                    removeTransparency: true,
                    backgroundColor: "#ffffff",
                    resizeMode: "cover",
                    width: dimension.width,
                    height: dimension.height,
                });
                await fs_1.default.promises.writeFile(outputPath, source);
            });
            return config;
        },
    ]);
};
/** Resolve and sanitize the icon set from config plugin props. */
function resolveIcons(props) {
    let icons = {};
    if (Array.isArray(props)) {
        icons = props.reduce((prev, curr, i) => ({ ...prev, [i]: { image: curr } }), {});
    }
    else if (props) {
        icons = props;
    }
    return icons;
}
/** Resolve the required icon dimension/target based on the app config. */
function resolveIconDimensions(config) {
    const targets = [];
    if (config.ios?.supportsTablet) {
        targets.push("ipad");
    }
    return ICON_DIMENSIONS.filter(({ target }) => !target || targets.includes(target)).map((dimension) => ({
        ...dimension,
        target: dimension.target ?? null,
        width: dimension.width ?? dimension.size * dimension.scale,
        height: dimension.height ?? dimension.size * dimension.scale,
    }));
}
/** Get the icon name, used to refer to the icon from within the plist */
function getIconName(name, dimension) {
    return `${name}-Icon-${dimension.size}x${dimension.size}`;
}
/** Get the full icon file name, including scale and possible target, used to write each exported icon to */
function getIconFileName(name, dimension) {
    const target = dimension.target ? `~${dimension.target}` : "";
    return `${getIconName(name, dimension)}@${dimension.scale}x${target}.png`;
}
/** Iterate all combinations of icons and dimensions to export */
async function iterateIconsAndDimensionsAsync({ icons, dimensions }, callback) {
    for (const [iconKey, icon] of Object.entries(icons)) {
        for (const dimension of dimensions) {
            await callback(iconKey, { icon, dimension });
        }
    }
}
exports.default = withDynamicIcon;
