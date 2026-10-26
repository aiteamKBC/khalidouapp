import BlurText from "@/components/react-bits/BlurText";
import { useReducedMotion } from "./useReducedMotion";

export default function AnimatedText({ text }: { text: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <span>{text}</span>;
  return (
    <BlurText
      text={text}
      delay={38}
      blur={4}
      distance={7}
      stepDuration={0.22}
      direction="bottom"
      className="motion-blur-text"
    />
  );
}
