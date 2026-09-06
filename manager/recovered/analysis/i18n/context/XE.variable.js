const La = () => y.useContext(GO),
    JO = ({ setSelectedMedia: e }) => {
      const { t } = Ve(),
        { inputIconsMainColor: n } = La(),
        r = y.useRef(null),
        s = y.useRef(null),
        [o, l] = y.useState(!1),
        u = (m) => {
          const g = m.target.files?.[0];
          if (!g) {
            e(null);
            return;
          }
          const x = g.type.split('/')[0],
            b = g.size / (1024 * 1024);
          switch (x) {
            case 'audio':
              if (b > 16) {
                me.error(t('chat.media.errors.audioSize'));
                return;
              }
              break;
            case 'image':
              if (b > 5) {
                me.error(t('chat.media.errors.imageSize'));
                return;
              }
              break;
            case 'video':
              if (b > 16) {
                me.error(t('chat.media.errors.videoSize'));
                return;
              }
              break;
            case 'application':
            case 'text':
              if (b > 100) {
                me.error(t('chat.media.errors.documentSize'));
                return;
              }
              break;
            default:
              me.error(t('chat.media.errors.unsupportedType'));
              return;
          }
          e(g);
        },
        d = (m) => {
          (m.preventDefault(), r.current && r.current.click());
        },
        f = (m) => {
          (m.preventDefault(), s.current && s.current.click());
        },
        h = [
          'text/plain',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/zip',
          'application/x-rar-compressed',
          'application/x-7z-compressed',
        ];
      return i.jsx(i.Fragment, {
        children: i.jsxs(Kr, {
          open: o,
          onOpenChange: l,
          children: [
            i.jsx(Wr, {
              asChild: !0,
              children: i.jsxs(se, {
                type: 'button',
                variant: 'ghost',
                size: 'icon',
                className: 'rounded-full p-2',
                children: [
                  i.jsx(cs, { className: 'h-6 w-6', style: { color: n } }),
                  i.jsx('span', { className: 'sr-only', children: t('chat.media.attach') }),
                ],
              }),
            }),
            i.jsxs(hr, {
              align: 'end',
              children: [
                i.jsx('input', { ref: s, type: 'file', accept: h.join(', '), onChange: u, className: 'hidden' }),
                i.jsxs(wt, {
                  onClick: f,
                  children: [i.jsx(rB, { className: 'mr-2 h-4 w-4' }), t('chat.media.document')],
                }),
                i.jsx('input', { ref: r, type: 'file', accept: 'image/*, video/*', onChange: u, className: 'hidden' }),
                i.jsxs(wt, {
                  onClick: d,
                  children: [i.jsx(uB, { className: 'mr-2 h-4 w-4' }), t('chat.media.photosAndVideos')],
                }),
              ],
            }),
          ],
        }),
      });
    },
    QO = ({ selectedMedia: e, setSelectedMedia: t }) => {
      const { t: n } = Ve(),
        r = () => {
          t(null);
        },
        s = (l) =>
          l.type.includes('image')
            ? i.jsx('img', {
                className: 'w-80 rounded-lg',
                src: URL.createObjectURL(l),
                alt: n('chat.media.selectedMedia.imageAlt'),
                style: { maxHeight: '400px', objectFit: 'contain' },
              })
            : l.type.includes('video')
              ? i.jsx('div', {
                  className: 'flex items-center justify-center',
                  children: i.jsx('video', {
                    className: 'w-80 rounded-lg object-cover',
                    src: URL.createObjectURL(l),
                    controls: !0,
                  }),
                })
              : i.jsx('div', {
                  className: 'flex items-center justify-center',
                  children: i.jsxs('span', {
                    className: 'flex items-center gap-2',
                    children: [i.jsx(Hb, { className: 'h-6 w-6' }), n('chat.media.selectedMedia.file')],
                  }),
                }),
        o = (l) => {
          const u = ['B', 'KB', 'MB', 'GB', 'TB'];
          let d = 0;
          for (; l > 1024; ) ((l /= 1024), d++);
          return `${l.toFixed(2)} ${u[d]}`;
        };
      return i.jsxs('div', {
        className: 'relative flex items-center rounded-lg bg-[#e0f0f0] dark:bg-[#1d2724] dark:text-white',
        children: [
          i.jsx('div', { className: 'absolute h-full w-1 rounded-l-lg bg-blue-700 dark:bg-blue-300' }),
          i.jsxs('div', {
            className: 'flex w-full flex-col items-center justify-center gap-6 p-4 pl-4',
            children: [
              e && s(e),
              i.jsxs('div', {
                className: 'flex flex-col items-center justify-center gap-2',
                children: [
                  i.jsx('span', {
                    className: 'text-sm font-medium',
                    children: e?.name || n('chat.media.selectedMedia.selectedFile'),
                  }),
                  i.jsx('span', { className: 'text-xs text-gray-500', children: o(e?.size || 0) }),
                ],
              }),
            ],
          }),
          i.jsx(se, {
            size: 'icon',
            variant: 'ghost',
            className: 'ml-auto h-10 w-10 rounded-full',
            onClick: r,
            children: i.jsx(qb, { className: 'h-6 w-6' }),
          }),
        ],
      });
    },
    XE = (e) => {
      const t = new Date(),
        n = new Date(t);
      n.setDate(n.getDate() - 1);
      const r = new Date(e);
      return r.toDateString() === t.toDateString()
        ? 'Hoje'
        : r.toDateString() === n.toDateString()
          ? 'Ontem'
          : Math.floor((t.getTime() - r.getTime()) / (1e3 * 60 * 60 * 24)) < 7
            ? r.toLocaleDateString('pt-BR', { weekday: 'long' })
            : r.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },
    Yv = (e) => {
      try {
        if (!e.messageTimestamp) return new Date();
        if (typeof e.messageTimestamp == 'object') {
          const n =
            [
              e.messageTimestamp.low,
              e.messageTimestamp.seconds,
              e.messageTimestamp.timestamp,
              e.messageTimestamp.time,
              e.messageTimestamp.value,
            ].find((r) => typeof r == 'number' && !isNaN(r)) || Date.now() / 1e3;
          return new Date(n * 1e3);
        } else if (isNaN(Number(e.messageTimestamp))) {
          if (typeof e.messageTimestamp == 'string' && e.messageTimestamp.includes('T'))
            return new Date(e.messageTimestamp);
        } else {
          const t = Number(e.messageTimestamp);
          return t > 1e12 ? new Date(t) : new Date(t * 1e3);
        }
        return new Date();
      } catch {
        return new Date();
      }
    },
    cX = ({ date: e }) =>
      i.jsx('div', {
        className: 'flex items-center justify-center py-4',
        children: i.jsx('div', {
          className: 'rounded-full bg-muted px-3 py-1',
          children: i.jsx('span', { className: 'text-sm font-medium text-muted-foreground', children: e }),
        }),
      }),
    uX = (e) => {
      if (!e) return '';
      if (typeof e == 'string')
        try {
          const t = JSON.parse(e);
          return t.conversation || t.text || e;
        } catch {
          return e;
        }
      return typeof e == 'object' ? e.conversation || e.text || '' : String(e);
    },
    ek = ({ message: e }) => {
      const t = e.messageType;
      switch (t) {
        case 'conversation':
          if (e.message.contactMessage) {
            const d = e.message.contactMessage;
            return i.jsxs('div', {
              className: 'p-3 bg-muted rounded-lg max-w-xs',
              children: [
                i.jsxs('div', {
                  className: 'flex items-center gap-2 mb-2',
                  children: [
                    i.jsx('div', { className: 'text-xl', children: '👤' }),
                    i.jsx('span', { className: 'font-medium', children: 'Contact' }),
                  ],
                }),
                d.displayName && i.jsx('p', { className: 'text-sm font-medium', children: d.displayName }),
                d.vcard && i.jsx('p', { className: 'text-xs text-muted-foreground', children: 'Contact card' }),
              ],
            });
          }
          if (e.message.locationMessage) {
            const d = e.message.locationMessage;
            return i.jsxs('div', {
              className: 'p-3 bg-muted rounded-lg max-w-xs',
              children: [
                i.jsxs('div', {
                  className: 'flex items-center gap-2 mb-2',
                  children: [
                    i.jsx('div', { className: 'text-xl', children: '📍' }),
                    i.jsx('span', { className: 'font-medium', children: 'Location' }),
                  ],
                }),
                d.name && i.jsx('p', { className: 'text-sm font-medium', children: d.name }),
                d.address && i.jsx('p', { className: 'text-xs text-muted-foreground', children: d.address }),
                d.degreesLatitude &&
                  d.degreesLongitude &&
                  i.jsx('a', {
                    href: `https://maps.google.com/?q=${d.degreesLatitude},${d.degreesLongitude}`,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    className: 'text-primary hover:underline text-sm mt-1 inline-block',
                    children: 'View on Maps',
                  }),
              ],
            });
          }
          return i.jsx('span', { children: uX(e.message) });
        case 'extendedTextMessage':
          return i.jsx('span', { children: e.message.conversation ?? e.message.extendedTextMessage?.text });
        case 'imageMessage':
          const r =
            (e.message.base64
              ? e.message.base64.startsWith('data:')
                ? e.message.base64
                : `data:image/jpeg;base64,${e.message.base64}`
              : null) || e.message.mediaUrl;
          return i.jsxs('div', {
            className: 'flex flex-col gap-2',
            children: [
              r
                ? i.jsx('img', {
                    src: r,
                    alt: 'Image',
                    className: 'rounded-lg max-w-full h-auto',
                    style: { maxWidth: '400px', maxHeight: '400px', objectFit: 'contain' },
                    loading: 'lazy',
                  })
                : i.jsxs('div', {
                    className: 'rounded bg-muted p-4 max-w-xs',
                    children: [
                      i.jsx('p', {
                        className: 'text-center text-muted-foreground',
                        children: "Image couldn't be loaded",
                      }),
                      i.jsx('p', {
                        className: 'text-center text-xs text-muted-foreground mt-1',
                        children: 'Missing base64 data and mediaUrl',
                      }),
                    ],
                  }),
              e.message.imageMessage?.caption &&
                i.jsx('p', { className: 'text-sm', children: e.message.imageMessage.caption }),
            ],
          });
        case 'videoMessage':
          const o =
            (e.message.base64
              ? e.message.base64.startsWith('data:')
                ? e.message.base64
                : `data:video/mp4;base64,${e.message.base64}`
              : null) || e.message.mediaUrl;
          return i.jsxs('div', {
            className: 'flex flex-col gap-2',
            children: [
              o
                ? i.jsx('video', {
                    src: o,
                    controls: !0,
                    className: 'rounded-lg max-w-full h-auto',
                    style: { maxWidth: '400px', maxHeight: '400px' },
                  })
                : i.jsxs('div', {
                    className: 'rounded bg-muted p-4 max-w-xs',
                    children: [
                      i.jsx('p', {
                        className: 'text-center text-muted-foreground',
                        children: "Video couldn't be loaded",
                      }),
                      i.jsx('p', {
                        className: 'text-center text-xs text-muted-foreground mt-1',
                        children: 'Missing base64 data and mediaUrl',
                      }),
                    ],
                  }),
              e.message.videoMessage?.caption &&
                i.jsx('p', { className: 'text-sm', children: e.message.videoMessage.caption }),
            ],
          });
        case 'audioMessage':
          const u =
            (e.message.base64
              ? e.message.base64.startsWith('data:')
                ? e.message.base64
                : `data:audio/mpeg;base64,${e.message.base64}`
              : null) || e.message.mediaUrl;
          return u
            ? i.jsxs('audio', {
                controls: !0,
                className: 'w-full max-w-xs',
                children: [
                  i.jsx('source', { src: u, type: 'audio/mpeg' }),
                  'Your browser does not support the audio element.',
                ],
              })
            : i.jsxs('div', {
                className: 'rounded bg-muted p-4 max-w-xs',
                children: [
                  i.jsx('p', { className: 'text-center text-muted-foreground', children: "Audio couldn't be loaded" }),
                  i.jsx('p', {
                    className: 'text-center text-xs text-muted-foreground mt-1',
                    children: 'Missing base64 data and mediaUrl',
                  }),
                ],
              });
        case 'documentMessage':
          return i.jsxs('div', {
            className: 'flex items-center gap-2 p-3 bg-muted rounded-lg max-w-xs',
            children: [
              i.jsx('div', { className: 'text-2xl', children: '📄' }),
              i.jsxs('div', {
                className: 'flex-1 min-w-0',
                children: [
                  i.jsx('p', {
                    className: 'font-medium truncate',
                    children: e.message.documentMessage?.fileName || 'Document',
                  }),
                  e.message.documentMessage?.fileLength &&
                    i.jsxs('p', {
                      className: 'text-xs text-muted-foreground',
                      children: [(e.message.documentMessage.fileLength / 1024 / 1024).toFixed(2), ' MB'],
                    }),
                ],
              }),
            ],
          });
        case 'stickerMessage':
          return i.jsx('img', {
            src: e.message.mediaUrl,
            alt: 'Sticker',
            className: 'max-w-32 max-h-32 object-contain',
          });
        default:
          return i.jsx('div', {
            className: 'text-xs text-muted-foreground bg-muted p-2 rounded max-w-xs',
            children: i.jsxs('details', {
              children: [
                i.jsxs('summary', { children: ['Unknown message type: ', t] }),
                i.jsx('pre', {
                  className: 'mt-2 whitespace-pre-wrap break-all text-xs',
                  children: JSON.stringify(e.message, null, 2),
                }),
              ],
            }),
          });
      }
    };
