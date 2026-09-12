"use client";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";

interface AppShellProps {
  sidebarCollapsed: boolean;
  children: ReactNode;
}

export function AppShell({ sidebarCollapsed, children }: AppShellProps) {
  return (
    <div className="flex w-full bg-background">
      <Sidebar collapsed={sidebarCollapsed} />
      {sidebarCollapsed ? (
        <div className="flex min-h-screen min-w-0 flex-1 flex-col md:pl-16">
          <TopBar />
          <main className="flex-1 p-6">{children}</main>
        </div>
      ) : (
        <div className="flex min-h-screen min-w-0 flex-1 flex-col md:pl-60">
          <TopBar />
          <main className="flex-1 p-6">{children}</main>
        </div>
      )}
    </div>
  );
}
