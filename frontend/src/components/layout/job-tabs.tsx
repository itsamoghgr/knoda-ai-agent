"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { JobResponse } from "@/types/api";

const tabs = [
  { href: "", label: "Progress" },
  { href: "/catalog", label: "Catalog" },
  { href: "/profiles", label: "Profiles" },
  { href: "/relationships", label: "Relationships" },
  { href: "/semantic", label: "Semantic Layer" },
];

const COMPLETED = "completed";

interface JobTabsProps {
  jobId: string;
  job: JobResponse;
}

export function JobTabs({ jobId, job }: JobTabsProps) {
  const pathname = usePathname();
  const base = `/jobs/${jobId}`;
  const isCompleted = job.status === COMPLETED;

  return (
    <div className="border-b px-6">
      <nav className="flex gap-0" aria-label="Job tabs">
        {tabs.map(({ href, label }) => {
          const fullHref = `${base}${href}`;
          const isActive = href === "" ? pathname === base : pathname.startsWith(fullHref);
          const isDisabled = href !== "" && !isCompleted;

          if (isDisabled) {
            return (
              <span
                key={href}
                className="cursor-not-allowed border-b-2 border-transparent px-4 py-3 text-sm font-medium text-muted-foreground/40"
                title="Available after job completes"
              >
                {label}
              </span>
            );
          }

          return (
            <Link
              key={href}
              href={fullHref}
              className={cn(
                "border-b-2 px-4 py-3 text-sm font-medium transition-colors hover:text-foreground",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-muted",
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
