import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFile } from "@/api/client";
import { cn } from "@/lib/utils";

type ProtectedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  eager?: boolean;
  onLoadError?: () => void;
};

export function ProtectedImage({
  src,
  eager = false,
  onLoadError,
  className,
  alt,
  ...props
}: ProtectedImageProps) {
  const imageRef = useRef<HTMLElement | null>(null);
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
      { rootMargin: "80px" },
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
    retry: false,
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

  if (!objectUrl) {
    return (
      <span
        ref={(element) => {
          imageRef.current = element;
        }}
        role="img"
        aria-label={typeof alt === "string" ? alt : undefined}
        aria-busy={visible && image.isLoading}
        className={cn(
          "block bg-[linear-gradient(135deg,hsl(var(--muted))_0%,hsl(var(--card))_45%,hsl(var(--muted))_100%)]",
          className,
        )}
      />
    );
  }

  return (
    <img
      {...props}
      ref={(element) => {
        imageRef.current = element;
      }}
      src={objectUrl}
      alt={alt}
      className={className}
      loading={eager ? "eager" : (props.loading ?? "lazy")}
      aria-busy={visible && image.isLoading}
    />
  );
}
