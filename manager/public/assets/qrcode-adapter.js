(() => {
  'use strict';

  if (typeof globalThis.qrcode !== 'function') return;

  globalThis.QRCode = Object.freeze({
    async toDataURL(value, options = {}) {
      const text = String(value || '');
      if (!text) throw new Error('Conteúdo do QR Code vazio.');

      const level = ['L', 'M', 'Q', 'H'].includes(options.errorCorrectionLevel)
        ? options.errorCorrectionLevel
        : 'M';
      const qr = globalThis.qrcode(0, level);
      qr.addData(text, 'Byte');
      qr.make();

      const moduleCount = qr.getModuleCount();
      const desiredWidth = Math.max(160, Number(options.width || 280));
      const marginModules = Math.max(1, Number(options.margin ?? 2));
      const cellSize = Math.max(3, Math.floor(desiredWidth / (moduleCount + marginModules * 2)));
      const marginPx = cellSize * marginModules;
      return qr.createDataURL(cellSize, marginPx);
    },
  });
})();
