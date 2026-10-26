import { useEffect, useRef, type ComponentProps } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { gsap, ScrollTrigger } from "./runtime";
import { useReducedMotion } from "./useReducedMotion";
import "./motion.css";

export default function MotionPage({
  children,
  scrollContainer,
  ...props
}: ComponentProps<"div"> & { scrollContainer?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !root.current) return;
    const scope = root.current;
    const wrapper = scrollContainer ? scope.querySelector<HTMLElement>(scrollContainer) : null;
    const lenis = new Lenis({
      wrapper: wrapper ?? window,
      content: wrapper ?? document.documentElement,
      autoRaf: false,
      autoToggle: true,
      lerp: 0.12,
      smoothWheel: true,
      syncTouch: false,
      anchors: { offset: -84 },
      prevent: (node) =>
        document.body.hasAttribute("data-scroll-locked") ||
        document.body.style.overflow === "hidden" ||
        Boolean(
          node.closest(
            '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-lenis-prevent]',
          ),
        ),
    });
    const tick = (seconds: number) => lenis.raf(seconds * 1000);
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const reveals = new Map<HTMLElement, gsap.core.Tween>();
    const context = gsap.context(() => {}, scope);
    let frame = 0;
    const scan = () => {
      frame = 0;
      reveals.forEach((tween, element) => {
        if (!scope.contains(element)) {
          tween.scrollTrigger?.kill();
          tween.kill();
          reveals.delete(element);
        }
      });
      context.add(() => {
        scope.querySelectorAll<HTMLElement>("section, [data-motion-reveal]").forEach((element) => {
          if (reveals.has(element) || element.closest('[role="dialog"], [role="alertdialog"]'))
            return;
          const tween = gsap.fromTo(
            element,
            { opacity: 0, y: 12 },
            {
              opacity: 1,
              y: 0,
              duration: 0.55,
              ease: "power2.out",
              clearProps: "opacity,transform",
              scrollTrigger: {
                trigger: element,
                scroller: wrapper ?? undefined,
                start: "top 96%",
                once: true,
              },
            },
          );
          reveals.set(element, tween);
        });
      });
      ScrollTrigger.refresh();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(scan);
    };
    const refreshLayout = () => {
      lenis.resize();
      schedule();
    };
    const mutations = new MutationObserver((records) => {
      if (
        records.some((record) =>
          [...record.addedNodes, ...record.removedNodes].some(
            (node) => node.nodeType === Node.ELEMENT_NODE,
          ),
        )
      )
        schedule();
    });
    mutations.observe(scope, { childList: true, subtree: true });
    const resize = new ResizeObserver(refreshLayout);
    resize.observe(scope);
    if (wrapper) resize.observe(wrapper);
    window.addEventListener("resize", refreshLayout);
    scan();
    return () => {
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", refreshLayout);
      cancelAnimationFrame(frame);
      context.revert();
      lenis.off("scroll", ScrollTrigger.update);
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, [reduced, scrollContainer]);

  return (
    <div {...props} ref={root} data-motion-page="" data-reduced-motion={reduced}>
      {children}
    </div>
  );
}
