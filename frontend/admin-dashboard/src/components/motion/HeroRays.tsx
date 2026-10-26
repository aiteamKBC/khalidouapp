import { lazy, Suspense } from "react";
import { useReducedMotion } from "./useReducedMotion";

const LightRays = lazy(() => import("@/components/react-bits/LightRays"));

export default function HeroRays({ color = "#9d145e" }: { color?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <div className="motion-hero-rays" aria-hidden="true">
      <Suspense fallback={null}>
        <LightRays
          raysColor={color}
          raysOrigin="top-right"
          raysSpeed={0.12}
          lightSpread={0.75}
          rayLength={1.2}
          rayDensity={0.7}
          intensity={0.5}
          glow={0.15}
          haze={0.1}
          followMouse={false}
          cursorShadow={false}
          clickPulse={false}
          intro={false}
          maxDevicePixelRatio={1}
        />
      </Suspense>
    </div>
  );
}
