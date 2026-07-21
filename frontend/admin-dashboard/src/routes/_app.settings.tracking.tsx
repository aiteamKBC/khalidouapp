import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertTriangle, Database, Loader2, Save } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getTrackingSettings, updateTrackingSettings } from "@/api/settings";
import { getScreenshotStorageStatus } from "@/api/screenshots";
import { Progress } from "@/components/ui/progress";
import type { TrackingSettings } from "@/types";
import { useAuth } from "@/lib/auth";
import { permissions } from "@/lib/permissions";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/settings/tracking")({
  component: TrackingSettingsPage,
});

function TrackingSettingsPage() {
  const { can } = useAuth();
  const canEdit = can(permissions.settingsManage);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["tracking-settings"], queryFn: getTrackingSettings });
  const storage = useQuery({
    queryKey: ["screenshot-storage-status"],
    queryFn: getScreenshotStorageStatus,
    enabled: canEdit,
    refetchInterval: 60_000,
  });
  const [form, setForm] = useState<TrackingSettings | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (query.data && !form) setForm(query.data);
  }, [query.data, form]);

  const mut = useMutation({
    mutationFn: (next: TrackingSettings) => updateTrackingSettings(next),
    onSuccess: () => {
      toast.success("Settings saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["tracking-settings"] });
    },
    onError: () => toast.error("Failed to save settings"),
  });

  if (!form) return <div className="text-sm text-muted-foreground">Loading settings…</div>;

  const update = <K extends keyof TrackingSettings>(k: K, v: TrackingSettings[K]) => {
    setForm({ ...form, [k]: v });
    setDirty(true);
  };

  const invalid =
    form.idleThresholdMinutes < 1 ||
    form.offlineThresholdMinutes < 1 ||
    form.screenshotsPerInterval < 1 ||
    form.screenshotsPerInterval > 2 ||
    form.screenshotRetentionDays < 1;

  return (
    <div className="studio-page-narrow">
      <PageHeader
        title="Tracking Settings"
        description={
          canEdit
            ? "Configure how Khaliduo tracks activity."
            : "Read-only view. Only General Admins can edit."
        }
      />

      {dirty && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          You have unsaved changes.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Screenshots</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <ToggleRow
            label="Enable screenshots"
            hint="Capture at unpredictable times inside each interval. Employees never see the next capture time."
          >
            <Switch
              disabled={!canEdit}
              checked={form.screenshotsEnabled}
              onCheckedChange={(v) => update("screenshotsEnabled", v)}
            />
          </ToggleRow>
          <FieldRow label="Screenshot interval">
            <Select
              disabled={!canEdit}
              value={String(form.screenshotIntervalMinutes)}
              onValueChange={(v) =>
                update(
                  "screenshotIntervalMinutes",
                  Number(v) as TrackingSettings["screenshotIntervalMinutes"],
                )
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[5, 10, 15, 20, 30].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Screenshots per interval">
            <Select
              disabled={!canEdit}
              value={String(form.screenshotsPerInterval)}
              onValueChange={(value) => update("screenshotsPerInterval", Number(value))}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 random screenshot</SelectItem>
                <SelectItem value="2">2 random screenshots</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <ToggleRow
            label="Capture during idle"
            hint="Still take screenshots when the user is idle."
          >
            <Switch
              disabled={!canEdit}
              checked={form.captureDuringIdle}
              onCheckedChange={(v) => update("captureDuringIdle", v)}
            />
          </ToggleRow>
          <FieldRow label="Retention (days)">
            <Input
              disabled={!canEdit}
              type="number"
              min={1}
              className="w-32"
              value={form.screenshotRetentionDays}
              onChange={(e) => update("screenshotRetentionDays", Number(e.target.value))}
            />
          </FieldRow>
        </CardContent>
      </Card>

      {canEdit && storage.data && (
        <Card className={`mt-6 ${storage.data.healthy ? "" : "border-destructive/40"}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {storage.data.healthy ? (
                <Database className="h-5 w-5 text-primary" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-destructive" />
              )}
              Screenshot storage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold">{storage.data.usedPercent}% used</p>
                <p className="text-sm text-muted-foreground">
                  {formatBytes(storage.data.freeBytes)} free of{" "}
                  {formatBytes(storage.data.totalBytes)}
                </p>
              </div>
              <span
                className={`text-sm font-medium ${storage.data.healthy ? "text-success" : "text-destructive"}`}
              >
                {storage.data.healthy ? "Healthy" : "Action required"}
              </span>
            </div>
            <Progress value={storage.data.usedPercent} />
            <p className="text-xs text-muted-foreground">
              Warning starts at {storage.data.warningPercent}%. Expired screenshots are cleaned
              automatically every few hours.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Activity thresholds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <FieldRow label="Idle threshold (minutes)">
            <Input
              disabled={!canEdit}
              type="number"
              min={1}
              className="w-32"
              value={form.idleThresholdMinutes}
              onChange={(e) => update("idleThresholdMinutes", Number(e.target.value))}
            />
          </FieldRow>
          <FieldRow label="Offline threshold (minutes)">
            <Input
              disabled={!canEdit}
              type="number"
              min={1}
              className="w-32"
              value={form.offlineThresholdMinutes}
              onChange={(e) => update("offlineThresholdMinutes", Number(e.target.value))}
            />
          </FieldRow>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={!dirty}
            onClick={() => {
              setForm(query.data!);
              setDirty(false);
            }}
          >
            Discard
          </Button>
          <Button disabled={!dirty || invalid || mut.isPending} onClick={() => mut.mutate(form)}>
            {mut.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save changes
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
      <div>
        <Label className="text-sm">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
