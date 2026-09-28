import { Injectable } from '@angular/core';
interface GoogleIdentity {
  initialize(config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    auto_select: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: { theme: string; size: string; width: number; text: string; locale: string },
  ): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}
@Injectable({ providedIn: 'root' })
export class GoogleService {
  private pending?: Promise<void>;
  load(): Promise<void> {
    if (window.google?.accounts.id) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      const timer = setTimeout(() => {
        script.remove();
        reject(Error('Google no respondió. Comprueba tu conexión y vuelve a intentarlo.'));
      }, 15000);
      script.onload = () => {
        clearTimeout(timer);
        window.google?.accounts.id ? resolve() : reject(Error('No se pudo cargar Google.'));
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(Error('No se pudo cargar Google. Comprueba tu conexión.'));
      };
      document.head.appendChild(script);
    });
    void this.pending.catch(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  async button(
    parent: HTMLElement,
    clientId: string,
    callback: (idToken: string) => void,
  ): Promise<void> {
    await this.load();
    parent.replaceChildren();
    window.google!.accounts.id.initialize({
      client_id: clientId,
      auto_select: false,
      callback: (response) => callback(response.credential),
    });
    window.google!.accounts.id.renderButton(parent, {
      theme: 'outline',
      size: 'large',
      width: 300,
      text: 'signin_with',
      locale: 'es',
    });
  }
}
