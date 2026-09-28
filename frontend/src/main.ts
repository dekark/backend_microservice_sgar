import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
bootstrapApplication(App, appConfig).catch(() => {
  const root = document.querySelector('app-root');
  if (root) {
    const message = document.createElement('p');
    message.className = 'alert error';
    message.textContent =
      'No se pudo iniciar el frontend. Comprueba app-config.json y vuelve a cargar la p?gina.';
    root.replaceChildren(message);
  }
});
