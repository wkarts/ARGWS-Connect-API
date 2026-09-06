const yd = {
    transitional: Kj,
    adapter: ['xhr', 'http', 'fetch'],
    transformRequest: [
      function (t, n) {
        const r = n.getContentType() || '',
          s = r.indexOf('application/json') > -1,
          o = ce.isObject(t);
        if ((o && ce.isHTMLForm(t) && (t = new FormData(t)), ce.isFormData(t))) return s ? JSON.stringify(Wj(t)) : t;
        if (
          ce.isArrayBuffer(t) ||
          ce.isBuffer(t) ||
          ce.isStream(t) ||
          ce.isFile(t) ||
          ce.isBlob(t) ||
          ce.isReadableStream(t)
        )
          return t;
        if (ce.isArrayBufferView(t)) return t.buffer;
        if (ce.isURLSearchParams(t))
          return (n.setContentType('application/x-www-form-urlencoded;charset=utf-8', !1), t.toString());
        let u;
        if (o) {
          if (r.indexOf('application/x-www-form-urlencoded') > -1) return E4(t, this.formSerializer).toString();
          if ((u = ce.isFileList(t)) || r.indexOf('multipart/form-data') > -1) {
            const d = this.env && this.env.FormData;
            return Ch(u ? { 'files[]': t } : t, d && new d(), this.formSerializer);
          }
        }
        return o || s ? (n.setContentType('application/json', !1), T4(t)) : t;
      },
    ],
    transformResponse: [
      function (t) {
        const n = this.transitional || yd.transitional,
          r = n && n.forcedJSONParsing,
          s = this.responseType === 'json';
        if (ce.isResponse(t) || ce.isReadableStream(t)) return t;
        if (t && ce.isString(t) && ((r && !this.responseType) || s)) {
          const l = !(n && n.silentJSONParsing) && s;
          try {
            return JSON.parse(t, this.parseReviver);
          } catch (u) {
            if (l) throw u.name === 'SyntaxError' ? vt.from(u, vt.ERR_BAD_RESPONSE, this, null, this.response) : u;
          }
        }
        return t;
      },
    ],
    timeout: 0,
    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',
    maxContentLength: -1,
    maxBodyLength: -1,
    env: { FormData: rr.classes.FormData, Blob: rr.classes.Blob },
    validateStatus: function (t) {
      return t >= 200 && t < 300;
    },
    headers: { common: { Accept: 'application/json, text/plain, */*', 'Content-Type': void 0 } },
  };
