import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { useEffect, useState } from "react";
import Drawer from "@/components/employee-workspace/Drawer";
import type { Employee } from "@/components/employee-workspace/model";

type Props = {
  busy: boolean;
  open: boolean;
  employee: Employee;
  onClose: () => void;
  onSave: (values: { name: string; role: string; email: string; avatar: string }) => void;
};

export default function ProfileDrawer({ open, employee, onClose, onSave, busy }: Props) {
  const [name, setName] = useState(employee.name);
  const role = employee.role;
  const email = employee.email;
  const [avatar, setAvatar] = useState(employee.avatar);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(employee.name);
      setAvatar(employee.avatar);
      setError("");
    }
  }, [open, employee]);

  const save = () => {
    if (!name.trim()) return setError("Your name cannot be empty.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid work email.");
    setError("");
    onSave({ name: name.trim(), role: role.trim(), email: email.trim(), avatar });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Account"
      title="Edit profile"
      description="Your name and photo appear in the header and on every request you submit."
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-ew-line px-3 py-2 text-[12.5px] font-semibold text-ew-ink-2 transition-colors hover:bg-ew-bg-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="cursor-pointer rounded-md bg-ew-plum px-3.5 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-ew-plum-2"
          >
            Save changes
          </button>
        </div>
      }
    >
      <div className="flex items-center gap-3">
        <Avatar className="h-16 w-16 rounded-xl">
          <AvatarImage src={avatar || undefined} alt="" />
          <AvatarFallback>{employee.firstName.slice(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-ew-ink">{employee.name}</p>
          <p className="mt-0.5 font-ew-mono text-[10px] uppercase tracking-[0.06em] text-ew-faint">
            {employee.employeeId} · {employee.team}
          </p>
          <label
            htmlFor="profile-photo"
            className="mt-1.5 inline-flex cursor-pointer items-center gap-1 rounded-md border border-ew-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ew-plum transition-colors hover:bg-ew-bg-2"
          >
            <WorkspaceIcon className="ri-image-add-line text-[13px]" aria-hidden="true" />
            Change photo
          </label>
          <input
            id="profile-photo"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
                  setError("Choose an image smaller than 2 MB.");
                } else {
                  const reader = new FileReader();
                  reader.onload = () => {
                    setAvatar(String(reader.result));
                    setError("");
                  };
                  reader.readAsDataURL(file);
                }
              }
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div>
          <label htmlFor="profile-name" className="k-field-label">
            Full name
          </label>
          <input
            id="profile-name"
            className="k-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            dir="auto"
            maxLength={80}
          />
        </div>
        <div>
          <label htmlFor="profile-role" className="k-field-label">
            Role
          </label>
          <input id="profile-role" className="k-input" value={role} readOnly maxLength={60} />
        </div>
        <div>
          <label htmlFor="profile-email" className="k-field-label">
            Work email
          </label>
          <input id="profile-email" type="email" className="k-input" value={email} readOnly />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md bg-ew-bad-2 px-2.5 py-1.5 text-[11.5px] font-medium text-ew-bad"
          >
            {error}
          </p>
        ) : null}

        <div className="rounded-lg border border-ew-line bg-ew-bg-2 px-3 py-2">
          <p className="text-[11.5px] leading-snug text-ew-ink-2">
            Attendance records, approvals and permissions are unaffected by profile changes.
          </p>
        </div>
      </form>
    </Drawer>
  );
}
