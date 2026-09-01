import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, RotateCw } from "lucide-react";
import { apiImageFile } from "@/api/client";
import { cn } from "@/lib/utils";
import {
  SCREENSHOT_FULL_IMAGE_CACHE_MS,
  SCREENSHOT_THUMBNAIL_CACHE_MS,
} from "@/lib/screenshot-display";
import { protectedImageQueryKey } from "@/lib/private-query-scope";

type ProtectedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  eager?: boolean;
  authToken?: string;
  cacheTimeMs?: number;
  onLoadError?: () => void;
};

export function ProtectedImage({
  src,
  eager = false,
  authToken,
  cacheTimeMs,
  onLoadError,
  className,
  alt,
  ...props
}: ProtectedImageProps) {
  const imageRef = useRef<HTMLElement | null>(null);
  const errorReported = useRef(false);
  const [visible, setVisible] = useState(eager);
  const [objectUrl, setObjectUrl] = useState<string>();
  const effectiveCacheTime =
    cacheTimeMs ?? (eager ? SCREENSHOT_FULL_IMAGE_CACHE_MS : SCREENSHOT_THUMBNAIL_CACHE_MS);

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
    queryKey: protectedImageQueryKey(src, authToken),
    queryFn: ({ signal }) => apiImageFile(src, signal, authToken),
    enabled: visible && Boolean(src),
    staleTime: effectiveCacheTime,
    gcTime: effectiveCacheTime,
    meta: { suppressGlobalLoading: true },
    retry: false,
  });

  useEffect(() => {
    setObjectUrl(undefined);
    if (!image.data) return;
    const nextUrl = URL.createObjectURL(image.data);
    setObjectUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [image.data]);

  useEffect(() => {
    errorReported.current = false;
  }, [src]);

  useEffect(() => {
    if (!image.isError || errorReported.current) return;
    errorReported.current = true;
    onLoadError?.();
  }, [image.isError, onLoadError]);

  if (visible && image.isError && !objectUrl) {
    return (
      <span
        ref={(element) => {
          imageRef.current = element;
        }}
        role="img"
        aria-label={typeof alt === "string" ? `${alt} unavailable` : "Image unavailable"}
        className={cn(
          "flex flex-col items-center justify-center gap-1.5 bg-muted/50 p-2 text-center text-[10px] font-semibold text-muted-foreground",
          className,
        )}
      >
        <ImageOff className="h-4 w-4" aria-hidden="true" />
        <span>Image unavailable</span>
        <span
          role="button"
          tabIndex={0}
          className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-foreground"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void image.refetch();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            void image.refetch();
          }}
        >
          <RotateCw className="h-3 w-3" aria-hidden="true" />
          Retry
        </span>
      </span>
    );
  }

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
