import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { authGuard, roleGuard, areaGuard, permissionGuard } from './core/guards';
import { Layout } from './features/layout';
const entityGuard: CanActivateFn = (route) =>
  (route.data['entities'] as string[]).includes(route.paramMap.get('entity') ?? '') ||
  inject(Router).createUrlTree(['/no-encontrado']);
const collection = () => import('./features/collection').then((m) => m.Collection);
export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login').then((m) => m.Login) },
  {
    path: 'sin-acceso',
    loadComponent: () => import('./features/status-page').then((m) => m.StatusPage),
  },
  {
    path: 'no-encontrado',
    data: { missing: true },
    loadComponent: () => import('./features/status-page').then((m) => m.StatusPage),
  },
  {
    path: '',
    component: Layout,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      {
        path: 'inicio',
        title: 'Resumen ? ?mbito',
        loadComponent: () => import('./features/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'perfil',
        title: 'Mi perfil ? ?mbito',
        loadComponent: () => import('./features/profile').then((m) => m.Profile),
      },
      {
        path: 'archivos',
        title: 'Archivos ? ?mbito',
        loadComponent: () => import('./features/files').then((m) => m.Files),
      },
      {
        path: 'gestion/:entity',
        canActivate: [roleGuard, permissionGuard, entityGuard],
        data: {
          scope: 'admin',
          roles: ['superadministrador'],
          permissions: [],
          entities: ['resources', 'users', 'areas', 'roles', 'permissions', 'audit'],
        },
        loadComponent: collection,
      },
      {
        path: 'mi-area/:entity',
        canActivate: [roleGuard, areaGuard, permissionGuard, entityGuard],
        data: {
          scope: 'area-admin',
          roles: ['administrador'],
          permissions: [],
          entities: ['resources', 'users', 'audit'],
        },
        loadComponent: collection,
      },
      {
        path: 'mis-recursos/:entity',
        canActivate: [roleGuard, areaGuard, entityGuard],
        data: { scope: 'area-user', roles: ['usuario normal'], entities: ['resources'] },
        loadComponent: collection,
      },
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
    ],
  },
  { path: '**', redirectTo: 'no-encontrado' },
];
