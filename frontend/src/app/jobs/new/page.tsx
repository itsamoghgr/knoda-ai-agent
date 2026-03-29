"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Database } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/lib/hooks/use-settings";
import { useStartJob } from "@/lib/hooks/use-jobs";
import { isLlmConfigured } from "@/lib/llm-settings";
import type { SourceConfig, SourceType } from "@/types/api";

const SOURCE_TYPES: { id: SourceType; label: string; icon: string }[] = [
  { id: "postgres", label: "PostgreSQL", icon: "🐘" },
  { id: "mysql", label: "MySQL", icon: "🐬" },
  { id: "duckdb", label: "DuckDB file", icon: "🦆" },
  { id: "s3_parquet", label: "S3 / Parquet", icon: "☁️" },
];

export default function NewJobPage() {
  const router = useRouter();
  const { data: settings } = useSettings();
  const startJobMutation = useStartJob();
  const [sourceType, setSourceType] = useState<SourceType>("postgres");
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState<Partial<SourceConfig>>({
    host: "", port: 5432, database: "", username: "", password: "",
    file_path: "", s3_bucket: "", s3_prefix: "", s3_region: "us-east-1",
    aws_access_key_id: "", aws_secret_access_key: "",
  });

  const llmConfigured = isLlmConfigured(settings);

  function update(field: keyof SourceConfig, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!llmConfigured) {
      toast.error("Configure an LLM provider first.");
      router.push("/settings");
      return;
    }

    const config: SourceConfig = { source_type: sourceType, ...form };

    try {
      const job = await startJobMutation.mutateAsync({ source_config: config });
      toast.success("Discovery job started!");
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to start job.");
    }
  }

  return (
    <div className="mx-auto max-w-xl p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Database className="h-6 w-6" /> Connect a Database
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          The agent will discover the schema and generate a semantic layer automatically.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Source type</CardTitle>
          <CardDescription>Choose the database you want to connect.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            {SOURCE_TYPES.map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSourceType(id)}
                className={`flex items-center gap-2 rounded-md border px-4 py-3 text-sm font-medium transition-colors ${
                  sourceType === id
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-accent"
                }`}
              >
                <span>{icon}</span> {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Connection details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Postgres / MySQL fields */}
            {(sourceType === "postgres" || sourceType === "mysql") && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor="host">Host</Label>
                    <Input id="host" placeholder="localhost" value={form.host ?? ""} onChange={(e) => update("host", e.target.value)} required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="port">Port</Label>
                    <Input id="port" type="number" value={form.port ?? (sourceType === "postgres" ? 5432 : 3306)} onChange={(e) => update("port", parseInt(e.target.value))} required />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="database">Database</Label>
                  <Input id="database" placeholder="my_database" value={form.database ?? ""} onChange={(e) => update("database", e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="username">Username</Label>
                  <Input id="username" placeholder="readonly_user" value={form.username ?? ""} onChange={(e) => update("username", e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input id="password" type={showPassword ? "text" : "password"} value={form.password ?? ""} onChange={(e) => update("password", e.target.value)} className="pr-10" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* DuckDB file */}
            {sourceType === "duckdb" && (
              <div className="space-y-1">
                <Label htmlFor="file_path">File path</Label>
                <Input id="file_path" placeholder="/path/to/database.duckdb" value={form.file_path ?? ""} onChange={(e) => update("file_path", e.target.value)} required />
              </div>
            )}

            {/* S3 / Parquet */}
            {sourceType === "s3_parquet" && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="s3_bucket">S3 Bucket</Label>
                  <Input id="s3_bucket" placeholder="my-data-bucket" value={form.s3_bucket ?? ""} onChange={(e) => update("s3_bucket", e.target.value)} required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="s3_prefix">Key prefix</Label>
                  <Input id="s3_prefix" placeholder="data/parquet/" value={form.s3_prefix ?? ""} onChange={(e) => update("s3_prefix", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="s3_region">Region</Label>
                  <Input id="s3_region" placeholder="us-east-1" value={form.s3_region ?? ""} onChange={(e) => update("s3_region", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="aws_key">AWS Access Key ID (optional)</Label>
                  <Input id="aws_key" value={form.aws_access_key_id ?? ""} onChange={(e) => update("aws_access_key_id", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="aws_secret">AWS Secret Access Key (optional)</Label>
                  <Input id="aws_secret" type="password" value={form.aws_secret_access_key ?? ""} onChange={(e) => update("aws_secret_access_key", e.target.value)} />
                </div>
              </>
            )}

            <Button type="submit" className="w-full" disabled={startJobMutation.isPending || !llmConfigured}>
              {startJobMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {!llmConfigured ? "Configure LLM first" : "Start Discovery"}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
