declare module "*.css";

interface Window {
  learnspaceDesktop?: {
    platform: string;
    startGoogleAuth(next: string): Promise<void>;
  };
}
