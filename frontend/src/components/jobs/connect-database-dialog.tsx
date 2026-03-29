"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Database, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useSettings } from "@/lib/hooks/use-settings";
import { isLlmConfigured } from "@/lib/llm-settings";
import { useStartJob } from "@/lib/hooks/use-jobs";
import { authHeaders } from "@/lib/api/client";
import type { SourceConfig, SourceType } from "@/types/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const SOURCE_TYPES: { id: SourceType; label: string; icon: string }[] = [
  { id: "postgres", label: "PostgreSQL", icon: "🐘" },
  { id: "mysql", label: "MySQL", icon: "🐬" },
  { id: "duckdb", label: "DuckDB file", icon: "🦆" },
  { id: "s3_parquet", label: "S3 / Parquet", icon: "☁️" },
];

interface EditJobInfo {
  id: string;
  source_config_safe: Record<string, unknown>;
}

interface ConnectDatabaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When present, the dialog operates in edit mode. */
  editJob?: EditJobInfo;
}

export function ConnectDatabaseDialog({
  open,
  onOpenChange,
  editJob,
}: ConnectDatabaseDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const startJobMutation = useStartJob();
  const [sourceType, setSourceType] = useState<SourceType>("postgres");
  const [showPassword, setShowPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isEditMode = !!editJob;

  const [form, setForm] = useState<Partial<SourceConfig>>({
    host: "", port: 5432, database: "", username: "", password: "",
    file_path: "", s3_bucket: "", s3_prefix: "", s3_region: "us-east-1",
    aws_access_key_id: "", aws_secret_access_key: "",
  });

  // Pre-fill form from source_config_safe when entering edit mode
  useEffect(() => {
    if (editJob?.source_config_safe) {
      const cfg = editJob.source_config_safe;
      const detectedType = (cfg.source_type as SourceType) ?? "postgres";
      setSourceType(detectedType);
      setForm({
        host:        (cfg.host as string)        ?? "",
        port:        (cfg.port as number)        ?? 5432,
        database:    (cfg.database as string)    ?? "",
        username:    (cfg.username as string)    ?? "",
        password:    "",  // never pre-fill — user must re-enter
        file_path:   (cfg.file_path as string)   ?? "",
        s3_bucket:   (cfg.s3_bucket as string)   ?? "",
        s3_prefix:   (cfg.s3_prefix as string)   ?? "",
        s3_region:   (cfg.s3_region as string)   ?? "us-east-1",
        aws_access_key_id:     (cfg.aws_access_key_id as string)     ?? "",
        aws_secret_access_key: (cfg.aws_secret_access_key as string) ?? "",
      });
    } else {
      // Reset form when switching back to create mode
      setSourceType("postgres");
      setForm({
        host: "", port: 5432, database: "", username: "", password: "",
        file_path: "", s3_bucket: "", s3_prefix: "", s3_region: "us-east-1",
        aws_access_key_id: "", aws_secret_access_key: "",
      });
    }
  }, [editJob]);

  const llmConfigured = isLlmConfigured(settings);

  function update(field: keyof SourceConfig, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const config: SourceConfig = { source_type: sourceType, ...form };

    if (isEditMode) {
      // Validate password is provided
      if (!form.password && (sourceType === "postgres" || sourceType === "mysql")) {
        toast.error("Please re-enter your password to save the updated connection.");
        return;
      }
      setIsSaving(true);
      try {
        const auth = await authHeaders();
        const res = await fetch(`${API_BASE}/api/v1/jobs/${editJob!.id}/source-config`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({ source_config: config }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail ?? "Failed to update connection.");
        }
        await queryClient.invalidateQueries({ queryKey: ["jobs"] });
        toast.success("Connection updated.");
        onOpenChange(false);
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to update connection.");
      } finally {
        setIsSaving(false);
      }
    } else {
      if (!llmConfigured) {
        toast.error("Configure an LLM provider first.");
        onOpenChange(false);
        router.push("/settings");
        return;
      }
      try {
        const job = await startJobMutation.mutateAsync({ source_config: config });
        toast.success("Discovery job started!");
        onOpenChange(false);
        router.push(`/jobs/${job.id}`);
      } catch (err) {
        toast.error((err as Error).message ?? "Failed to start job.");
      }
    }
  }

  const isPending = isEditMode ? isSaving : startJobMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            {isEditMode ? (
              <><Pencil className="h-4 w-4" /> Edit Connection</>
            ) : (
              <><Database className="h-4 w-4" /> Connect a Database</>
            )}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update your connection credentials. All discovery data is preserved."
              : "The agent will discover the schema and generate a semantic layer automatically."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Source type — read-only in edit mode */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Source type</p>
            <div className="grid grid-cols-2 gap-2">
              {SOURCE_TYPES.map(({ id, label, icon }) => (
                <button
                  key={id}
                  type="button"
                  disabled={isEditMode}
                  onClick={() => !isEditMode && setSourceType(id)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                    sourceType === id
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:bg-accent"
                  } ${isEditMode ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <span>{icon}</span> {label}
                </button>
              ))}
            </div>
          </div>

          {/* Connection fields */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Connection details</p>

              {(sourceType === "postgres" || sourceType === "mysql") && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-1">
                      <Label htmlFor="dlg-host">Host</Label>
                      <Input
                        id="dlg-host"
                        placeholder="localhost"
                        value={form.host ?? ""}
                        onChange={(e) => update("host", e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dlg-port">Port</Label>
                      <Input
                        id="dlg-port"
                        type="number"
                        value={form.port ?? (sourceType === "postgres" ? 5432 : 3306)}
                        onChange={(e) => update("port", parseInt(e.target.value))}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dlg-database">Database</Label>
                    <Input
                      id="dlg-database"
                      placeholder="my_database"
                      value={form.database ?? ""}
                      onChange={(e) => update("database", e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dlg-username">Username</Label>
                    <Input
                      id="dlg-username"
                      placeholder="readonly_user"
                      value={form.username ?? ""}
                      onChange={(e) => update("username", e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dlg-password">
                      Password
                      {isEditMode && (
                        <span className="ml-1 text-xs text-muted-foreground font-normal">
                          (re-enter to confirm)
                        </span>
                      )}
                    </Label>
                    <div className="relative">
                      <Input
                        id="dlg-password"
                        type={showPassword ? "text" : "password"}
                        placeholder={isEditMode ? "Enter password to save changes" : ""}
                        value={form.password ?? ""}
                        onChange={(e) => update("password", e.target.value)}
                        className="pr-10"
                        required={isEditMode}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {sourceType === "duckdb" && (
                <div className="space-y-1">
                  <Label htmlFor="dlg-file">File path</Label>
                  <Input
                    id="dlg-file"
                    placeholder="/path/to/database.duckdb"
                    value={form.file_path ?? ""}
                    onChange={(e) => update("file_path", e.target.value)}
                    required
                  />
                </div>
              )}

              {sourceType === "s3_parquet" && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="dlg-bucket">S3 Bucket</Label>
                    <Input id="dlg-bucket" placeholder="my-data-bucket" value={form.s3_bucket ?? ""} onChange={(e) => update("s3_bucket", e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dlg-prefix">Key prefix</Label>
                    <Input id="dlg-prefix" placeholder="data/parquet/" value={form.s3_prefix ?? ""} onChange={(e) => update("s3_prefix", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dlg-region">Region</Label>
                    <Input id="dlg-region" placeholder="us-east-1" value={form.s3_region ?? ""} onChange={(e) => update("s3_region", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dlg-key">AWS Access Key ID (optional)</Label>
                    <Input id="dlg-key" value={form.aws_access_key_id ?? ""} onChange={(e) => update("aws_access_key_id", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dlg-secret">AWS Secret Access Key (optional)</Label>
                    <Input id="dlg-secret" type="password" value={form.aws_secret_access_key ?? ""} onChange={(e) => update("aws_secret_access_key", e.target.value)} />
                  </div>
                </>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isPending || (!isEditMode && !llmConfigured)}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isEditMode
                ? (isPending ? "Saving…" : "Save Connection")
                : (!llmConfigured ? "Configure LLM first" : "Start Discovery")}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
