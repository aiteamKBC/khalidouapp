import { useState, type ReactNode } from "react";
import { Menu } from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/ui/brand-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen w-full bg-background">
      <div className="flex min-h-screen">
        <div className="sticky top-0 hidden h-screen lg:block">
          <AppSidebar />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur lg:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[260px] border-sidebar-border bg-sidebar p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <AppSidebar onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            <div className="flex items-center gap-2">
              <BrandLogo className="h-8 w-8" />
              <span className="text-sm font-semibold">Khaliduo</span>
            </div>
            <ThemeToggle className="ml-auto" />
          </header>

          <main className="studio-main min-w-0 flex-1 overflow-x-hidden p-4 sm:p-5 lg:px-7 lg:py-6 2xl:px-10">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
