import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, Clock3, Loader2, MailWarning, ShieldCheck } from "lucide-react";
import { acceptPersonInvitation, getPersonInvitation } from "@/api/people";
import { ApiClientError } from "@/api/client";
import { BrandLogo } from "@/components/ui/brand-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/accept-invitation")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" && search.token ? search.token : undefined,
  }),
  component: AcceptInvitationPage,
});

type UnavailableReason = "invalid" | "expired";

function unavailableReason(error: unknown): UnavailableReason {
  if (error instanceof ApiClientError) {
    if (error.status === 410 || error.code.toLowerCase().includes("expired")) return "expired";
  }
  if (error instanceof Error && error.message.toLowerCase().includes("expired")) return "expired";
  return "invalid";
}

function AcceptInvitationPage() {
  const { token } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string>();
  const [accepted, setAccepted] = useState(false);

  const invitation = useQuery({
    queryKey: ["public-invitation", token],
    queryFn: () => getPersonInvitation(token!),
    enabled: Boolean(token),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => acceptPersonInvitation(token!, password),
    onSuccess: () => {
      setAccepted(true);
      setPassword("");
      setConfirmPassword("");
    },
    onError: (error) =>
      setFormError(error instanceof Error ? error.message : "Could not accept invitation."),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);
    if (password.length < 8) {
      setFormError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }
    accept.mutate();
  }

  let content;
  if (!token) {
    content = <UnavailableInvitation reason="invalid" />;
  } else if (invitation.isPending) {
    content = (
      <StatePanel
        icon={<Loader2 className="h-9 w-9 animate-spin text-primary" />}
        title="Checking your invitation"
        message="This will only take a moment."
      />
    );
  } else if (invitation.isError) {
    content = <UnavailableInvitation reason={unavailableReason(invitation.error)} />;
  } else if (accepted) {
    content = (
      <StatePanel
        icon={<CheckCircle2 className="h-10 w-10 text-success" />}
        title="Your account is ready"
        message="Your password has been saved. You can now sign in to the employee portal."
      >
        <Button asChild className="mt-5 w-full">
          <a href="/employee">Open employee portal</a>
        </Button>
      </StatePanel>
    );
  } else if (!invitation.data.valid || invitation.data.status !== "pending") {
    content = (
      <UnavailableInvitation
        reason={invitation.data.status === "expired" ? "expired" : "invalid"}
      />
    );
  } else {
    content = (
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="items-center text-center">
          <BrandLogo className="mb-3 h-20 w-20 rounded-2xl" />
          <CardTitle className="text-2xl">Welcome to Khaliduo</CardTitle>
          <p className="text-sm text-muted-foreground">
            Hi {invitation.data.name}. Choose a password to finish setting up your employee account.
          </p>
        </CardHeader>
        <CardContent>
          <div className="mb-5 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="font-medium">{invitation.data.email}</div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" />
              Link expires {new Date(invitation.data.expiresAt).toLocaleString()}.
            </div>
          </div>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="invitation-password">Password</Label>
              <Input
                id="invitation-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invitation-confirm-password">Confirm password</Label>
              <Input
                id="invitation-confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Use at least 8 characters. This invitation works once and your password is never
              emailed back to anyone.
            </p>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <Button className="w-full" type="submit" disabled={accept.isPending}>
              {accept.isPending ? "Setting up account..." : "Accept invitation"}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-5">{content}</main>
  );
}

function UnavailableInvitation({ reason }: { reason: UnavailableReason }) {
  return (
    <StatePanel
      icon={
        reason === "expired" ? (
          <Clock3 className="h-10 w-10 text-warning-foreground" />
        ) : (
          <MailWarning className="h-10 w-10 text-destructive" />
        )
      }
      title={reason === "expired" ? "This invitation has expired" : "Invitation link is not valid"}
      message={
        reason === "expired"
          ? "Ask your administrator to resend the invitation. The new email will contain a fresh link."
          : "This link may have already been used or revoked. Ask your administrator for a new invitation."
      }
    >
      <Button asChild variant="outline" className="mt-5 w-full">
        <a href="/employee">Go to employee sign in</a>
      </Button>
    </StatePanel>
  );
}

function StatePanel({
  icon,
  title,
  message,
  children,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <Card className="w-full max-w-md p-8 text-center shadow-xl">
      <BrandLogo className="mx-auto mb-5 h-16 w-16 rounded-2xl" />
      <div className="mx-auto mb-4 flex justify-center">{icon}</div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      {children}
    </Card>
  );
}
