declare namespace Bun {
  interface ServeOptions {
    hostname?: string;
    port: number;
    idleTimeout?: number;
    fetch(request: Request): Response | Promise<Response>;
    error?(error: Error): Response | Promise<Response>;
  }

  interface Server {
    port: number;
    stop(closeActiveConnections?: boolean): void;
  }

  interface Subprocess {
    pid: number;
    exited: Promise<number>;
    kill(signal?: string | number): void;
  }

  interface BuildOutput {
    text(): Promise<string>;
  }

  interface BuildResult {
    success: boolean;
    logs: unknown[];
    outputs: BuildOutput[];
  }
}

declare const Bun: {
  serve(options: Bun.ServeOptions): Bun.Server;
  spawn(options: {
    cmd: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdin?: "inherit" | "ignore";
    stdout?: "inherit" | "ignore";
    stderr?: "inherit" | "ignore";
  }): Bun.Subprocess;
  build(options: {
    entrypoints: string[];
    target: "browser" | "bun";
    minify?: boolean;
  }): Promise<Bun.BuildResult>;
  file(path: string | URL): { text(): Promise<string> };
};
