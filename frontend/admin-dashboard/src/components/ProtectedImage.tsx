import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFile } from "@/api/client";

type ProtectedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  eager?: boolean;
  onLoadError?: () => void;
};

export function ProtectedImage({ src, eager = false, onLoadError, ...props }: ProtectedImageProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const errorReported = useRef(false);
  const [visible, setVisible] = useState(eager);
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    if (eager || visible) return;
    const element = imageRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [eager, visible]);

  const image = useQuery({
    queryKey: ["protected-image", src],
    queryFn: () => apiFile(src),
    enabled: visible && Boolean(src),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (!image.data) return;
    const nextUrl = URL.createObjectURL(image.data);
    setObjectUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [image.data]);

  useEffect(() => {
    if (!image.isError || errorReported.current) return;
    errorReported.current = true;
    onLoadError?.();
  }, [image.isError, onLoadError]);

  return (
    <img
      {...props}
      ref={imageRef}
      src={objectUrl}
      loading={eager ? "eager" : (props.loading ?? "lazy")}
      aria-busy={visible && image.isLoading}
    />
  );
}
