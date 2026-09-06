import { RouterBroker } from '@api/abstract/abstract.router';
import express, { Router } from 'express';
import fs from 'fs';
import path from 'path';

export class ViewsRouter extends RouterBroker {
  public readonly router: Router;

  constructor() {
    super();
    this.router = Router();

    const basePath = path.join(process.cwd(), 'manager', 'dist');
    const indexPath = path.join(basePath, 'index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');

    this.router.use(
      express.static(basePath, {
        dotfiles: 'deny',
        index: false,
      }),
    );

    this.router.get('*', (_req, res) => {
      res.status(200).type('html').send(indexHtml);
    });
  }
}
