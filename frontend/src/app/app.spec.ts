import { TestBed } from '@angular/core/testing';
import { App } from './app';
describe('App', () => {
  it('renders the accessible application shell', async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('a')?.textContent).toContain(
      'Saltar al contenido',
    );
  });
});
