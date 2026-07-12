import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  alt?: string;
}

export function BrandLogo({ className, alt = "Khaliduo by Kent Consultancy" }: BrandLogoProps) {
  return (
    <img
      src="/khaliduo-icon.png"
      alt={alt}
      className={cn("object-contain", className)}
      loading="eager"
      decoding="async"
    />
  );
}
