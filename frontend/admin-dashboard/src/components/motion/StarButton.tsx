import type { ComponentProps } from "react";
import StarBorder from "@/components/react-bits/StarBorder";
import { useReducedMotion } from "./useReducedMotion";

export default function StarButton(props: ComponentProps<"button">) {
  const reduced = useReducedMotion();
  return (
    <StarBorder
      {...props}
      color="#9d145e"
      trailColor="#412c6f"
      duration={12}
      thickness={1}
      radius={6}
      trailLength={0.14}
      glow={0.18}
      hover="none"
      clickPulse={false}
      sparkle={false}
      disabledMotion={reduced}
    />
  );
}
