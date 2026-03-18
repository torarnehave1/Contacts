declare module 'vegvisr-ui-kit' {
  import { ComponentType, HTMLAttributes } from 'react';

  interface AuthBarProps {
    userEmail?: string;
    badgeLabel?: string;
    signInLabel?: string;
    onSignIn?: () => void;
    logoutLabel?: string;
    onLogout?: () => void;
  }

  interface EcosystemNavProps extends HTMLAttributes<HTMLDivElement> {
    className?: string;
    showRecorder?: boolean;
    streamApiUrl?: string;
    onRecordingComplete?: (url: string) => void;
  }

  export const AuthBar: ComponentType<AuthBarProps>;
  export const EcosystemNav: ComponentType<EcosystemNavProps>;
}
