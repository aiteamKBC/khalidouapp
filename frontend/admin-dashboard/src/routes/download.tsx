import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Download, Laptop, ShieldCheck } from "lucide-react";
import { API_BASE_URL } from "@/api/client";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/download")({ component: DownloadPage });

const configuredDownloadUrl = import.meta.env.VITE_DESKTOP_DOWNLOAD_URL?.trim();
const windowsDownloadUrl = configuredDownloadUrl || `${API_BASE_URL}/downloads/windows`;

function DownloadPage() {
  return (
    <main className="min-h-screen bg-muted/30 px-5 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-center gap-3 text-center">
          <BrandLogo className="h-16 w-16 rounded-2xl" />
          <div className="text-left">
            <h1 className="text-3xl font-semibold">Download Khaliduo</h1>
            <p className="text-sm text-muted-foreground">Kent Consultancy staff application</p>
          </div>
        </header>

        <Card className="overflow-hidden shadow-xl">
          <CardHeader className="border-b bg-background">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-3 text-primary">
                <Laptop className="h-7 w-7" />
              </div>
              <div>
                <CardTitle>Khaliduo for Windows</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Windows 10 or 11, 64-bit</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-6">
            <p className="text-sm text-muted-foreground">
              Install Khaliduo, then enter the one-time enrollment code sent by your administrator.
            </p>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <a href={windowsDownloadUrl} download="KhaliduoSetup.exe">
                <Download className="h-5 w-5" /> Download for Windows
              </a>
            </Button>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex gap-2 rounded-lg border p-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span>Download only from your official Khaliduo dashboard.</span>
              </div>
              <div className="flex gap-2 rounded-lg border p-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span>Your enrollment code connects this computer to your staff account.</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <nav className="flex flex-wrap justify-center gap-4 text-sm">
          <a className="text-primary hover:underline" href="/employee">
            Employee dashboard
          </a>
          <a className="text-primary hover:underline" href="/login">
            Admin sign in
          </a>
        </nav>
      </div>
    </main>
  );
}
