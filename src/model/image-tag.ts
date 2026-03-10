/**
 * Bridge file — stub for ImageTag.
 *
 * Used by orchestrator to build Docker image references from
 * BuildParameters properties.
 */

class ImageTag {
  public repository: string;
  public editorVersion: string;
  public targetPlatform: string;
  public builderPlatform: string;
  public customImage: string;
  public imageRollingVersion: number;
  public imagePlatformPrefix: string;

  constructor(imageProperties: { [key: string]: string }) {
    const {
      editorVersion = '',
      targetPlatform = '',
      builderPlatform = '',
      customImage = '',
    } = imageProperties;

    this.repository = 'unityci';
    this.editorVersion = editorVersion;
    this.targetPlatform = targetPlatform;
    this.builderPlatform = builderPlatform;
    this.customImage = customImage;
    this.imageRollingVersion = 3;
    this.imagePlatformPrefix = ImageTag.getImagePlatformPrefixes(builderPlatform);
  }

  static get versionPattern(): RegExp {
    return /^\d+\.\d+\.\d+[a-z]\d+$/;
  }

  static get targetPlatformSuffixes(): { [key: string]: string } {
    return {
      StandaloneOSX: 'mac-mono',
      StandaloneWindows: 'windows-mono',
      StandaloneWindows64: 'windows-mono',
      StandaloneLinux64: 'linux-il2cpp',
      iOS: 'ios',
      Android: 'android',
      WebGL: 'webgl',
    };
  }

  static getImagePlatformPrefixes(platform: string): string {
    switch (platform) {
      case 'linux':
        return '';
      case 'win32':
        return 'windows-';
      case 'darwin':
        return 'mac-';
      default:
        return '';
    }
  }

  static getTargetPlatformToTargetPlatformSuffixMap(
    platform: string,
    _version: string,
    _providerStrategy: string,
  ): string {
    return ImageTag.targetPlatformSuffixes[platform] || platform.toLowerCase();
  }

  get tag(): string {
    return `${this.editorVersion}-${this.targetPlatform}-${this.imageRollingVersion}`;
  }

  get image(): string {
    return `${this.repository}/${this.imagePlatformPrefix}editor`;
  }

  toString(): string {
    if (this.customImage) return this.customImage;

    return `${this.image}:${this.tag}`;
  }
}

export default ImageTag;
export { ImageTag };
