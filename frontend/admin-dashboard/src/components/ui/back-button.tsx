import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

interface BackButtonProps extends Omit<ButtonProps, "asChild" | "onClick"> {
  fallbackHref: string;
}

export function BackButton({
  fallbackHref,
  children = "Back",
  type = "button",
  ...props
}: BackButtonProps) {
  const router = useRouter();

  function handleBack() {
    if (router.history.canGoBack()) {
      router.history.back();
      return;
    }

    router.history.replace(fallbackHref);
  }

  return (
    <Button type={type} onClick={handleBack} {...props}>
      <ArrowLeft className="h-4 w-4" />
      {children}
    </Button>
  );
}
