import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger } from "./runtime";
import { useReducedMotion } from "./useReducedMotion";

const numberFormat = (value: number) => Math.round(value).toLocaleString();

export default function AnimatedNumber({
  value,
  format = numberFormat,
}: {
  value: number;
  format?: (value: number) => string;
}) {
  const reduced = useReducedMotion();
  const element = useRef<HTMLSpanElement>(null);
  const progress = useRef({ value: 0 });
  const started = useRef(false);
  const formatter = useRef(format);
  formatter.current = format;

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    if (reduced || !Number.isFinite(value)) {
      node.textContent = formatter.current(value);
      if (started.current) progress.current.value = value;
      return;
    }
    let tween: gsap.core.Tween | undefined;
    const scale = 10 ** Math.min(3, String(value).split(".")[1]?.length ?? 0);
    const animate = () => {
      started.current = true;
      tween = gsap.to(progress.current, {
        value,
        duration: 0.85,
        ease: "power2.out",
        onUpdate: () => {
          node.textContent = formatter.current(Math.round(progress.current.value * scale) / scale);
        },
        onComplete: () => {
          node.textContent = formatter.current(value);
        },
      });
    };
    const trigger = started.current
      ? undefined
      : ScrollTrigger.create({
          trigger: node,
          scroller: node.closest<HTMLElement>("[data-motion-scroller]") ?? undefined,
          start: "top 98%",
          once: true,
          onEnter: animate,
        });
    if (started.current && !trigger) animate();
    return () => {
      trigger?.kill();
      tween?.kill();
    };
  }, [value, reduced]);

  return (
    <span className="motion-number">
      <span className="motion-number-reserve" aria-hidden="true">
        {format(value)}
      </span>
      <span ref={element} aria-hidden="true">
        {format(value)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
