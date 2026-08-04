/**
 * Progressive-enhancement guard for the WebGL scene layer.
 * Returns true when a usable WebGL2/WebGL context can be created.
 */
export function supportsWebGL(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    return gl !== null;
  } catch {
    return false;
  }
}
