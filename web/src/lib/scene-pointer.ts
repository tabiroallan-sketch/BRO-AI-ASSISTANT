/**
 * Global pointer singleton consumed by the 3D scene (sphere tilt, camera
 * parallax). Avoids React re-renders on every mouse move.
 */
export const scenePointer = {
  x: 0,
  y: 0,
  inside: false,
};

export function initScenePointer(): () => void {
  const onMove = (event: PointerEvent): void => {
    scenePointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    scenePointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    scenePointer.inside = true;
  };
  const onLeave = (): void => {
    scenePointer.inside = false;
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerleave', onLeave);
  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerleave', onLeave);
  };
}
