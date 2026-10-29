import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export function NativeWindowFrame() {
  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    const apply = (expanded: boolean) => {
      if (active) document.documentElement.dataset.windowExpanded = String(expanded);
    };
    const unsubscribe = window.khaliduo?.onWindowExpandedChanged((expanded) => {
      receivedUpdate = true;
      apply(expanded);
    });
    void window.khaliduo?.isWindowExpanded().then((expanded) => {
      if (!receivedUpdate) apply(expanded);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  return null;
}

export function NativeWindowControls() {
  return (
    <div className="rd-window-controls" data-native-window-controls>
      <WindowButtons />
    </div>
  );
}

function WindowButtons() {
  return (
    <>
      <button type="button" aria-label="Minimize" onClick={() => void window.khaliduo?.minimizeWindow()}>−</button>
      <button type="button" aria-label="Maximize or restore" onClick={() => void window.khaliduo?.toggleMaximizeWindow()}>□</button>
      <button type="button" aria-label="Close" onClick={() => void window.khaliduo?.closeWindow()}>×</button>
    </>
  );
}

// SweetAlert covers the whole renderer. Keep only the native window controls
// above it, in the same position and colors as the currently visible titlebar.
export function NativeModalWindowControls() {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useEffect(() => {
    const update = () => {
      if (!document.body.classList.contains("swal2-shown")) {
        setStyle(null);
        return;
      }
      const controls = [...document.querySelectorAll<HTMLElement>("[data-native-window-controls]")]
        .find(element => element.getBoundingClientRect().width > 0);
      if (!controls) {
        setStyle(null);
        return;
      }
      const rect = controls.getBoundingClientRect();
      const root = controls.closest(".tracker-frame, .desktop-login") ?? controls;
      const palette = getComputedStyle(root);
      observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-skin", "data-view"] });
      setStyle({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        color: getComputedStyle(controls.querySelector("button")!).color,
        background: palette.getPropertyValue("--k-card") || palette.getPropertyValue("--login-card") || "#211b30",
      });
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return style && createPortal(
    <div className="rd-window-controls native-modal-window-controls" style={style}>
      <WindowButtons />
    </div>,
    document.body,
  );
}
