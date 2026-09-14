"use client";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { cn } from "@/lib/utils";

interface AppShellProps {
  sidebarCollapsed: boolean;
  children: ReactNode;
}

export function AppShell({ sidebarCollapsed, children }: AppShellProps) {
  return (
    <div className="min-h-screen w-full bg-background">
      <Sidebar collapsed={sidebarCollapsed} />
      <div className={cn("flex min-h-screen min-w-0 flex-col", sidebarCollapsed ? "md:pl-16" : "md:pl-60")}>
        <TopBar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
