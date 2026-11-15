import birdUrl from "../assets/watermark-bird.png";
import horseUrl from "../assets/watermark-horse.png";

/** The Readdy design's canvas: faint dot grid and the two brand marks. */
export function Backdrop() {
  return (
    <>
      <div className="app-grid" aria-hidden="true" />
      <div className="k-wm k-wm-art k-wm-horse" aria-hidden="true">
        <img src={horseUrl} alt="" />
      </div>
      <div className="k-wm k-wm-art k-wm-bird" aria-hidden="true">
        <img src={birdUrl} alt="" />
      </div>
    </>
  );
}
