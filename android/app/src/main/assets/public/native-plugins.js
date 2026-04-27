// ══════════════════════════════════════════════════════════════════
// OBubba Native Plugin Bridge
// Unified API for all Capacitor native features
// Falls back gracefully to web APIs when not running natively
// Uses window.Capacitor.Plugins.* (NOT dynamic import()) for WKWebView
// ══════════════════════════════════════════════════════════════════

var isNative = function() {
  return typeof window !== 'undefined' &&
    window.Capacitor &&
    window.Capacitor.isNativePlatform();
};

var getPlatform = function() {
  return isNative() ? window.Capacitor.getPlatform() : 'web';
};

// Helper to get a Capacitor plugin safely
var _plug = function(name) {
  try { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]; }
  catch(e) { return null; }
};

// ── 1. HAPTICS ──────────────────────────────────────────────────
var OBHaptics = {
  impact: function(style) {
    style = style || 'Medium';
    if (!isNative()) {
      if (navigator.vibrate) navigator.vibrate(style === 'Heavy' ? 30 : style === 'Light' ? 5 : 15);
      return Promise.resolve();
    }
    var Haptics = _plug('Haptics');
    if (!Haptics) return Promise.resolve();
    return Haptics.impact({ style: style });
  },
  notification: function(type) {
    type = type || 'Success';
    if (!isNative()) return Promise.resolve();
    var Haptics = _plug('Haptics');
    if (!Haptics) return Promise.resolve();
    return Haptics.notification({ type: type });
  },
  selectionStart: function() {
    if (!isNative()) return Promise.resolve();
    var Haptics = _plug('Haptics');
    if (!Haptics) return Promise.resolve();
    return Haptics.selectionStart();
  },
  selectionChanged: function() {
    if (!isNative()) return Promise.resolve();
    var Haptics = _plug('Haptics');
    if (!Haptics) return Promise.resolve();
    return Haptics.selectionChanged();
  },
  selectionEnd: function() {
    if (!isNative()) return Promise.resolve();
    var Haptics = _plug('Haptics');
    if (!Haptics) return Promise.resolve();
    return Haptics.selectionEnd();
  }
};

// ── 2. BIOMETRIC AUTH (Face ID / Touch ID / Fingerprint) ────────
var OBBiometric = {
  isAvailable: function() {
    if (!isNative()) return Promise.resolve({ available: false, type: 'none' });
    var Bio = _plug('BiometricAuth');
    if (!Bio) return Promise.resolve({ available: false, type: 'none' });
    try {
      return Bio.checkBiometry().then(function(result) {
        return { available: result.isAvailable, type: result.biometryType, reason: result.reason };
      }).catch(function() { return { available: false, type: 'none' }; });
    } catch(e) { return Promise.resolve({ available: false, type: 'none' }); }
  },
  authenticate: function(reason) {
    reason = reason || 'Verify your identity';
    if (!isNative()) return Promise.resolve({ success: false, error: 'not_native' });
    var Bio = _plug('BiometricAuth');
    if (!Bio) return Promise.resolve({ success: false, error: 'no_plugin' });
    try {
      return Bio.authenticate({ reason: reason, allowDeviceCredential: true }).then(function() {
        return { success: true };
      }).catch(function(e) {
        return { success: false, error: (e && e.message) || 'auth_failed' };
      });
    } catch(e) { return Promise.resolve({ success: false, error: 'error' }); }
  }
};

// ── 3. SIGN IN WITH APPLE ───────────────────────────────────────
var OBAppleSignIn = {
  isAvailable: function() {
    return Promise.resolve(getPlatform() === 'ios');
  },
  signIn: function() {
    if (getPlatform() !== 'ios') return Promise.resolve({ success: false, error: 'not_ios' });
    var SIWA = _plug('SignInWithApple');
    if (!SIWA) return Promise.resolve({ success: false, error: 'no_plugin' });
    try {
      return SIWA.authorize({
        clientId: 'com.obubba.app',
        redirectURI: 'https://obubba.com/auth/apple/callback',
        scopes: 'email name',
        state: crypto.randomUUID(),
        nonce: crypto.randomUUID()
      }).then(function(result) {
        return {
          success: true,
          user: result.response.user,
          email: result.response.email,
          givenName: result.response.givenName,
          familyName: result.response.familyName,
          identityToken: result.response.identityToken,
          authorizationCode: result.response.authorizationCode
        };
      }).catch(function(e) {
        return { success: false, error: (e && e.message) || 'apple_signin_failed' };
      });
    } catch(e) { return Promise.resolve({ success: false, error: 'error' }); }
  }
};

// ── 4. GOOGLE SIGN-IN (removed — not shipping) ─────────────────
var OBGoogleSignIn = {
  signIn: function() { return Promise.resolve({ success: false, error: 'not_available' }); },
  signOut: function() { return Promise.resolve(); }
};

// ── 5. PUSH NOTIFICATIONS (APNs + FCM) ─────────────────────────
var OBPushNotifications = {
  _listeners: [],

  requestPermission: function() {
    if (!isNative()) {
      if ('Notification' in window) {
        return Notification.requestPermission().then(function(result) {
          return { granted: result === 'granted' };
        });
      }
      return Promise.resolve({ granted: false });
    }
    var PN = _plug('PushNotifications');
    if (!PN) return Promise.resolve({ granted: false });
    return PN.requestPermissions().then(function(perm) {
      return { granted: perm.receive === 'granted' };
    });
  },

  register: function() {
    if (!isNative()) return Promise.resolve({ token: null });
    var PN = _plug('PushNotifications');
    if (!PN) return Promise.resolve({ token: null });
    PN.register();
    return new Promise(function(resolve) {
      PN.addListener('registration', function(token) {
        resolve({ token: token.value });
      });
      PN.addListener('registrationError', function(err) {
        resolve({ token: null, error: err.error });
      });
    });
  },

  onNotificationReceived: function(callback) {
    if (!isNative()) return Promise.resolve();
    var PN = _plug('PushNotifications');
    if (!PN) return Promise.resolve();
    try {
      var listener = PN.addListener('pushNotificationReceived', callback);
      this._listeners.push(listener);
    } catch(e) {}
    return Promise.resolve();
  },

  onNotificationTapped: function(callback) {
    if (!isNative()) return Promise.resolve();
    var PN = _plug('PushNotifications');
    if (!PN) return Promise.resolve();
    try {
      var listener = PN.addListener('pushNotificationActionPerformed', function(action) {
        callback(action.notification, action.actionId);
      });
      this._listeners.push(listener);
    } catch(e) {}
    return Promise.resolve();
  },

  setBadgeCount: function(count) {
    var Badge = _plug('Badge');
    if (!Badge) return Promise.resolve();
    try { return Badge.set({ count: count }).catch(function(){}); }
    catch(e) { return Promise.resolve(); }
  },

  clearBadge: function() {
    var Badge = _plug('Badge');
    if (!Badge) return Promise.resolve();
    try { return Badge.clear().catch(function(){}); }
    catch(e) { return Promise.resolve(); }
  }
};

// ── 6. LOCAL NOTIFICATIONS ──────────────────────────────────────
var OBLocalNotifications = {
  schedule: function(opts) {
    var id = opts.id, title = opts.title, body = opts.body;
    var scheduleAt = opts.scheduleAt, extra = opts.extra, channelId = opts.channelId;
    if (!isNative()) {
      if ('Notification' in window && Notification.permission === 'granted') {
        var delay = new Date(scheduleAt).getTime() - Date.now();
        if (delay > 0 && delay < 86400000) {
          setTimeout(function() { new Notification(title, { body: body, icon: '/icons/icon-192.png', data: extra }); }, delay);
        }
      }
      return Promise.resolve();
    }
    var LN = _plug('LocalNotifications');
    if (!LN) return Promise.resolve();
    return LN.schedule({
      notifications: [{
        id: id || Math.floor(Math.random() * 100000),
        title: title,
        body: body,
        schedule: { at: new Date(scheduleAt) },
        sound: 'notification.wav',
        extra: extra || {},
        channelId: channelId || 'obubba_reminders'
      }]
    });
  },

  cancelAll: function() {
    if (!isNative()) return Promise.resolve();
    var LN = _plug('LocalNotifications');
    if (!LN) return Promise.resolve();
    return LN.getPending().then(function(pending) {
      if (pending.notifications.length > 0) {
        return LN.cancel(pending);
      }
    });
  },

  createChannels: function() {
    if (getPlatform() !== 'android') return Promise.resolve();
    var LN = _plug('LocalNotifications');
    if (!LN) return Promise.resolve();
    return LN.createChannel({
      id: 'obubba_reminders',
      name: 'Reminders',
      description: 'Feed, sleep, and medicine reminders',
      importance: 4,
      sound: 'notification.wav',
      vibration: true
    }).then(function() {
      return LN.createChannel({
        id: 'obubba_timers',
        name: 'Active Timers',
        description: 'Running feed and sleep timers',
        importance: 3,
        sound: null,
        vibration: false
      });
    }).then(function() {
      return LN.createChannel({
        id: 'obubba_milestones',
        name: 'Milestones',
        description: 'Developmental milestone reminders',
        importance: 3,
        sound: 'notification.wav',
        vibration: true
      });
    });
  }
};

// ── 7. APP SHORTCUTS (3D Touch / Long Press Home Icon) ──────────
var OBAppShortcuts = {
  set: function(shortcuts) {
    if (!isNative()) return Promise.resolve();
    var AS = _plug('AppShortcuts');
    if (!AS) return Promise.resolve();
    try {
      return AS.set({
        shortcuts: shortcuts.map(function(s) {
          return {
            id: s.id,
            title: s.title,
            description: s.description || '',
            iconName: s.icon || undefined
          };
        })
      }).catch(function(){});
    } catch(e) { return Promise.resolve(); }
  },

  onShortcutUsed: function(callback) {
    if (!isNative()) return Promise.resolve();
    var AS = _plug('AppShortcuts');
    if (!AS) return Promise.resolve();
    try {
      AS.addListener('shortcut', function(event) {
        callback(event.shortcutId);
      });
    } catch(e) {}
    return Promise.resolve();
  }
};

// ── 8. CAMERA ───────────────────────────────────────────────────
var OBCamera = {
  takePhoto: function() {
    if (!isNative()) {
      return new Promise(function(resolve) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.onchange = function(e) {
          var file = e.target.files[0];
          if (!file) return resolve(null);
          var reader = new FileReader();
          reader.onload = function() { resolve({ dataUrl: reader.result, format: 'jpeg' }); };
          reader.readAsDataURL(file);
        };
        input.click();
      });
    }
    var Cam = _plug('Camera');
    if (!Cam) return Promise.resolve(null);
    return Cam.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: 'dataUrl',
      source: 'PROMPT',
      width: 1200,
      correctOrientation: true
    }).then(function(photo) {
      return { dataUrl: photo.dataUrl, format: photo.format };
    });
  },

  pickFromGallery: function() {
    if (!isNative()) return this.takePhoto();
    var Cam = _plug('Camera');
    if (!Cam) return Promise.resolve(null);
    return Cam.getPhoto({
      quality: 85,
      allowEditing: false,
      resultType: 'dataUrl',
      source: 'PHOTOS',
      width: 1200,
      correctOrientation: true
    }).then(function(photo) {
      return { dataUrl: photo.dataUrl, format: photo.format };
    });
  }
};

// ── 9. SHARE ────────────────────────────────────────────────────
var OBShare = {
  share: function(opts) {
    var title = opts.title, text = opts.text, url = opts.url, files = opts.files;
    if (!isNative()) {
      if (navigator.share) {
        return navigator.share({ title: title, text: text, url: url }).then(function() {
          return { shared: true };
        });
      }
      return navigator.clipboard.writeText(url || text || '').then(function() {
        return { shared: false, copied: true };
      });
    }
    var Share = _plug('Share');
    if (!Share) return Promise.resolve({ shared: false });
    return Share.share({ title: title, text: text, url: url, files: files }).then(function(result) {
      return { shared: true, activityType: result.activityType };
    });
  }
};

// ── 10. NETWORK STATUS ──────────────────────────────────────────
var OBNetwork = {
  getStatus: function() {
    if (!isNative()) {
      return Promise.resolve({ connected: navigator.onLine, connectionType: navigator.onLine ? 'wifi' : 'none' });
    }
    var Net = _plug('Network');
    if (!Net) return Promise.resolve({ connected: navigator.onLine, connectionType: 'unknown' });
    return Net.getStatus().then(function(status) {
      return { connected: status.connected, connectionType: status.connectionType };
    });
  },

  onStatusChange: function(callback) {
    if (!isNative()) {
      window.addEventListener('online', function() { callback({ connected: true, connectionType: 'wifi' }); });
      window.addEventListener('offline', function() { callback({ connected: false, connectionType: 'none' }); });
      return Promise.resolve();
    }
    var Net = _plug('Network');
    if (!Net) return Promise.resolve();
    Net.addListener('networkStatusChange', callback);
    return Promise.resolve();
  }
};

// ── 11. SQLITE (Offline-first persistence) ──────────────────────
var OBDatabase = {
  _db: null,

  init: function() {
    if (!isNative()) return Promise.resolve(false);
    // Guard: prevent double SQLite init (causes "Connection already exists" error)
    if (this._db || this._initInProgress) return Promise.resolve(this._db || false);
    this._initInProgress = true;
    var SQL = _plug('CapacitorSQLite');
    if (!SQL) { this._initInProgress = false; return Promise.resolve(false); }
    var self = this;
    try {
      // Use unencrypted for existing users — encryption requires migration which risks data loss
      return SQL.createConnection({ database: 'obubba', version: 1, encrypted: false, mode: 'no-encryption' })
        .then(function() { return SQL.open({ database: 'obubba' }); })
        .then(function() {
          return SQL.execute({
            database: 'obubba',
            statements: 'CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, date TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, synced INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS children (id TEXT PRIMARY KEY, data TEXT NOT NULL, synced INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS milestones (id TEXT PRIMARY KEY, child_id TEXT, data TEXT NOT NULL, synced INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date); CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type); CREATE INDEX IF NOT EXISTS idx_entries_synced ON entries(synced);'
          });
        })
        .then(function() { self._db = true; self._initInProgress = false; return true; })
        .catch(function(e) { console.warn('SQLite init failed:', e); self._initInProgress = false; return false; });
    } catch(e) { console.warn('SQLite init error:', e); self._initInProgress = false; return Promise.resolve(false); }
  },

  put: function(table, id, data) {
    if (!this._db) return Promise.resolve();
    var SQL = _plug('CapacitorSQLite');
    if (!SQL) return Promise.resolve();
    var json = JSON.stringify(data);
    return SQL.run({
      database: 'obubba',
      statement: 'INSERT OR REPLACE INTO ' + table + ' (id, data, synced) VALUES (?, ?, 0)',
      values: [id, json]
    });
  },

  get: function(table, id) {
    if (!this._db) return Promise.resolve(null);
    var SQL = _plug('CapacitorSQLite');
    if (!SQL) return Promise.resolve(null);
    return SQL.query({
      database: 'obubba',
      statement: 'SELECT data FROM ' + table + ' WHERE id = ?',
      values: [id]
    }).then(function(result) {
      if (result.values && result.values.length > 0) {
        return JSON.parse(result.values[0].data);
      }
      return null;
    });
  },

  getAll: function(table) {
    if (!this._db) return Promise.resolve([]);
    var SQL = _plug('CapacitorSQLite');
    if (!SQL) return Promise.resolve([]);
    return SQL.query({
      database: 'obubba',
      statement: 'SELECT id, data FROM ' + table,
      values: []
    }).then(function(result) {
      return (result.values || []).map(function(r) {
        var parsed = JSON.parse(r.data);
        parsed.id = r.id;
        return parsed;
      });
    });
  }
};

// ── 12. SIRI SHORTCUTS (iOS) ────────────────────────────────────
var OBSiri = {
  donateShortcut: function(opts) {
    if (getPlatform() !== 'ios') return Promise.resolve();
    var Siri = _plug('OBSiriShortcuts');
    if (!Siri) return Promise.resolve();
    try {
      return Siri.donate({
        activityType: 'com.obubba.app.' + opts.id,
        title: opts.title,
        suggestedPhrase: opts.phrase,
        isEligibleForSearch: true,
        isEligibleForPrediction: true
      }).catch(function(){});
    } catch(e) { return Promise.resolve(); }
  },

  donateAllShortcuts: function() {
    var shortcuts = [
      { id: 'log_feed', title: 'Log a Feed', phrase: 'Log a feed in OBubba' },
      { id: 'log_sleep', title: 'Log Sleep', phrase: 'Log sleep in OBubba' },
      { id: 'log_nappy', title: 'Log a Nappy', phrase: 'Log a nappy in OBubba' },
      { id: 'start_feed_timer', title: 'Start Feed Timer', phrase: 'Start feed timer' },
      { id: 'start_sleep_timer', title: 'Start Sleep Timer', phrase: 'Start sleep timer' },
      { id: 'baby_summary', title: 'Baby Summary', phrase: "How's baby doing?" },
      { id: 'last_feed', title: 'Last Feed', phrase: 'When was the last feed?' },
      { id: 'log_temperature', title: 'Log Temperature', phrase: 'Log baby temperature' },
      { id: 'log_medicine', title: 'Log Medicine', phrase: 'Log baby medicine' }
    ];
    var self = this;
    var chain = Promise.resolve();
    shortcuts.forEach(function(s) {
      chain = chain.then(function() { return self.donateShortcut(s); });
    });
    return chain;
  }
};

// ── 13. WIDGETS (iOS WidgetKit + Android Glance) ────────────────
var OBWidgets = {
  updateWidgetData: function() {
    // Widget data is now managed by the main app (app-v2.jsx) with full data shape.
    // This legacy sender creates incomplete data that overwrites the good data. Skip.
    return Promise.resolve();
  },

  reloadWidgets: function() {
    if (!isNative()) return Promise.resolve();
    var WB = _plug('OBWidgetBridge');
    if (!WB) return Promise.resolve();
    try { return WB.reloadAll().catch(function(){}); }
    catch(e) { return Promise.resolve(); }
  }
};

// ── 14. LIVE ACTIVITIES (iOS) / FOREGROUND TIMER SERVICE (Android) ──
var OBLiveActivity = {
  startTimer: function(opts) {
    var platform = getPlatform();
    if (platform === 'ios') {
      var LA = _plug('OBLiveActivity');
      if (!LA) return Promise.resolve();
      try {
        return LA.start({
          type: opts.type,
          startTime: opts.startTime || Date.now(),
          babyName: opts.babyName || 'Baby',
          side: opts.side || null
        }).catch(function(){});
      } catch(e) { return Promise.resolve(); }
    }
    if (platform === 'android') {
      var TS = _plug('OBTimerService');
      if (!TS) return Promise.resolve();
      try {
        return TS.startTimer({
          type: opts.type || 'feed',
          startTime: opts.startTime || Date.now(),
          babyName: opts.babyName || 'Baby',
          side: opts.side || null
        }).catch(function(){});
      } catch(e) { return Promise.resolve(); }
    }
    return Promise.resolve();
  },

  updateTimer: function(opts) {
    var platform = getPlatform();
    if (platform === 'ios') {
      var LA = _plug('OBLiveActivity');
      if (!LA) return Promise.resolve();
      try { return LA.update({ elapsed: opts.elapsed, side: opts.side }).catch(function(){}); }
      catch(e) { return Promise.resolve(); }
    }
    if (platform === 'android') {
      var TS = _plug('OBTimerService');
      if (!TS) return Promise.resolve();
      try { return TS.updateTimer({ side: opts.side, babyName: opts.babyName }).catch(function(){}); }
      catch(e) { return Promise.resolve(); }
    }
    return Promise.resolve();
  },

  stopTimer: function() {
    var platform = getPlatform();
    if (platform === 'ios') {
      var LA = _plug('OBLiveActivity');
      if (!LA) return Promise.resolve();
      try { return LA.stop().catch(function(){}); }
      catch(e) { return Promise.resolve(); }
    }
    if (platform === 'android') {
      var TS = _plug('OBTimerService');
      if (!TS) return Promise.resolve();
      try { return TS.stopTimer().catch(function(){}); }
      catch(e) { return Promise.resolve(); }
    }
    return Promise.resolve();
  },

  startPrediction: function(opts) {
    var platform = getPlatform();
    if (platform === 'ios') {
      var LA = _plug('OBLiveActivity');
      if (!LA || !LA.startPrediction) return Promise.resolve();
      try { return LA.startPrediction(opts).catch(function(){}); }
      catch(e) { return Promise.resolve(); }
    }
    if (platform === 'android') {
      var TS = _plug('OBTimerService');
      if (!TS) return Promise.resolve();
      try { return TS.startPrediction({
        targetTime: opts.targetTime || 0,
        label: opts.label || 'Next event',
        babyName: opts.babyName || 'Baby',
        timeFormatted: opts.timeFormatted || null
      }).catch(function(){}); }
      catch(e) { return Promise.resolve(); }
    }
    return Promise.resolve();
  },

  stopPrediction: function() {
    var platform = getPlatform();
    if (platform === 'ios') {
      var LA = _plug('OBLiveActivity');
      if (!LA || !LA.stopPrediction) return Promise.resolve();
      try { return LA.stopPrediction().catch(function(){}); }
      catch(e) { return Promise.resolve(); }
    }
    if (platform === 'android') {
      var TS = _plug('OBTimerService');
      if (!TS) return Promise.resolve();
      try { return TS.stopPrediction().catch(function(){}); }
      catch(e) { return Promise.resolve(); }
    }
    return Promise.resolve();
  }
};

// ── 15. (removed) ───────────────────────────────────────────────
var OBHealth = {
  isAvailable: function() { return Promise.resolve(false); },
  requestPermission: function() { return Promise.resolve(false); },
  saveWeight: function() { return Promise.resolve(); },
  saveHeight: function() { return Promise.resolve(); }
};

// ── 16. SPEECH RECOGNITION (Voice Logging) ──────────────────────
var OBSpeech = {
  isAvailable: function() {
    if (!isNative()) {
      return Promise.resolve('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
    }
    var SR = _plug('SpeechRecognition');
    if (!SR) return Promise.resolve(false);
    try {
      return SR.available().then(function(result) { return result.available; })
        .catch(function() { return false; });
    } catch(e) { return Promise.resolve(false); }
  },

  listen: function(language) {
    language = language || 'en-GB';
    if (!isNative()) {
      return new Promise(function(resolve, reject) {
        var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRec) return reject(new Error('Not supported'));
        var recognition = new SpeechRec();
        recognition.lang = language;
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.onresult = function(e) { resolve(e.results[0][0].transcript); };
        recognition.onerror = function(e) { reject(e.error); };
        recognition.start();
      });
    }
    var SR = _plug('SpeechRecognition');
    if (!SR) return Promise.reject(new Error('Not available'));
    return SR.requestPermission().then(function() {
      return SR.start({ language: language, popup: false });
    }).then(function(result) {
      return (result.matches && result.matches[0]) || '';
    });
  },

  stop: function() {
    if (!isNative()) return Promise.resolve();
    var SR = _plug('SpeechRecognition');
    if (!SR) return Promise.resolve();
    return SR.stop();
  }
};

// ── 17. APP LIFECYCLE ───────────────────────────────────────────
var OBAppLifecycle = {
  onResume: function(callback) {
    if (!isNative()) {
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') callback();
      });
      return Promise.resolve();
    }
    var AppPlug = _plug('App');
    if (!AppPlug) return Promise.resolve();
    AppPlug.addListener('appStateChange', function(state) {
      if (state.isActive) callback();
    });
    return Promise.resolve();
  },

  onPause: function(callback) {
    if (!isNative()) {
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') callback();
      });
      return Promise.resolve();
    }
    var AppPlug = _plug('App');
    if (!AppPlug) return Promise.resolve();
    AppPlug.addListener('appStateChange', function(state) {
      if (!state.isActive) callback();
    });
    return Promise.resolve();
  },

  onBackButton: function(callback) {
    if (!isNative()) return Promise.resolve();
    var AppPlug = _plug('App');
    if (!AppPlug) return Promise.resolve();
    AppPlug.addListener('backButton', callback);
    return Promise.resolve();
  },

  onUrlOpen: function(callback) {
    if (!isNative()) return Promise.resolve();
    var AppPlug = _plug('App');
    if (!AppPlug) return Promise.resolve();
    AppPlug.addListener('appUrlOpen', function(data) {
      callback(data.url);
    });
    return Promise.resolve();
  }
};

// ── 18. SCREEN ORIENTATION ──────────────────────────────────────
var OBScreen = {
  lockPortrait: function() {
    if (!isNative()) return Promise.resolve();
    var SO = _plug('ScreenOrientation');
    if (!SO) return Promise.resolve();
    try { return SO.lock({ orientation: 'portrait' }).catch(function(){}); }
    catch(e) { return Promise.resolve(); }
  }
};

// ── 19. STATUS BAR ──────────────────────────────────────────────
var OBStatusBar = {
  setStyle: function(isDark) {
    if (!isNative()) return Promise.resolve();
    var SB = _plug('StatusBar');
    if (!SB) return Promise.resolve();
    var chain = SB.setStyle({ style: isDark ? 'DARK' : 'LIGHT' });
    if (getPlatform() === 'android') {
      chain = chain.then(function() {
        return SB.setBackgroundColor({ color: isDark ? '#080e1c' : '#F0DDD6' });
      });
    }
    return chain;
  },
  hide: function() {
    if (!isNative()) return Promise.resolve();
    var SB = _plug('StatusBar');
    if (!SB) return Promise.resolve();
    return SB.hide();
  },
  show: function() {
    if (!isNative()) return Promise.resolve();
    var SB = _plug('StatusBar');
    if (!SB) return Promise.resolve();
    return SB.show();
  }
};

// ── 20. IN-APP PURCHASES (StoreKit 2 / Google Play Billing) ────
// Bridges to the native OBStore Capacitor plugin on both iOS and Android.
// Sets window._purchases for the app to use.
var OBStore = {
  _products: null,

  // Load all products from the store
  getProducts: function() {
    if (!isNative()) return Promise.resolve([]);
    var Store = _plug('OBStore');
    if (!Store) return Promise.resolve([]);
    try {
      return Store.getProducts().then(function(result) {
        var products = result.products || [];
        OBStore._products = products;
        return products;
      }).catch(function(e) {
        console.warn('[OBStore] getProducts error:', e);
        return [];
      });
    } catch(e) { return Promise.resolve([]); }
  },

  // Get a single product by period (monthly/annual/lifetime)
  // Prefers v2 products (new pricing) over v1 for new subscribers
  getProduct: function(period) {
    var _findProduct = function(products) {
      if (!products || !products.length) return null;
      var fallback = null;
      for (var i = 0; i < products.length; i++) {
        var p = products[i];
        var match = (period === 'monthly' && p.period === 'monthly') ||
                    (period === 'annual' && p.period === 'annual') ||
                    (period === 'lifetime' && p.type === 'nonConsumable');
        if (match) {
          if (p.id && p.id.indexOf('.v2') !== -1) return p; // prefer v2
          if (!fallback) fallback = p;
        }
      }
      return fallback;
    };

    // Use cached products if available
    if (OBStore._products) return Promise.resolve(_findProduct(OBStore._products));

    // Otherwise load first
    return OBStore.getProducts().then(function(products) {
      return _findProduct(products);
    });
  },

  // Purchase a product (pass the product object from getProduct)
  purchase: function(product) {
    if (!isNative() || !product) return Promise.resolve({ success: false });
    var Store = _plug('OBStore');
    if (!Store) return Promise.resolve({ success: false });
    try {
      return Store.purchase({ productId: product.id }).then(function(result) {
        return result;
      }).catch(function(e) {
        console.warn('[OBStore] purchase error:', e);
        return { success: false, error: (e && e.message) || 'purchase_failed' };
      });
    } catch(e) { return Promise.resolve({ success: false, error: 'error' }); }
  },

  // Restore purchases
  restore: function() {
    if (!isNative()) return Promise.resolve({ isPremium: false });
    var Store = _plug('OBStore');
    if (!Store) return Promise.resolve({ isPremium: false });
    try {
      return Store.restore().then(function(result) {
        return result;
      }).catch(function(e) {
        console.warn('[OBStore] restore error:', e);
        return { isPremium: false };
      });
    } catch(e) { return Promise.resolve({ isPremium: false }); }
  },

  // Check active entitlements (returns boolean)
  checkEntitlements: function() {
    if (!isNative()) return Promise.resolve(false);
    var Store = _plug('OBStore');
    if (!Store) return Promise.resolve(false);
    try {
      return Store.getEntitlements().then(function(result) {
        return !!(result && result.isPremium);
      }).catch(function() { return false; });
    } catch(e) { return Promise.resolve(false); }
  }
};

// ── 22. APP REVIEW (SKStoreReviewController / Google Play Review) ─
var OBReview = {
  requestReview: function() {
    if (!isNative()) return Promise.resolve({ requested: false });
    var Review = _plug('OBReview');
    if (!Review) return Promise.resolve({ requested: false });
    try {
      return Review.requestReview().then(function(result) {
        return result || { requested: true };
      }).catch(function() { return { requested: false }; });
    } catch(e) { return Promise.resolve({ requested: false }); }
  }
};

// ── 21. PREFERENCES (Key-Value, replaces localStorage on native) ─
var OBPreferences = {
  get: function(key) {
    if (!isNative()) return Promise.resolve(localStorage.getItem(key));
    var Pref = _plug('Preferences');
    if (!Pref) return Promise.resolve(localStorage.getItem(key));
    return Pref.get({ key: key }).then(function(result) { return result.value; });
  },
  set: function(key, value) {
    if (!isNative()) { localStorage.setItem(key, value); return Promise.resolve(); }
    var Pref = _plug('Preferences');
    if (!Pref) { localStorage.setItem(key, value); return Promise.resolve(); }
    return Pref.set({ key: key, value: value });
  },
  remove: function(key) {
    if (!isNative()) { localStorage.removeItem(key); return Promise.resolve(); }
    var Pref = _plug('Preferences');
    if (!Pref) { localStorage.removeItem(key); return Promise.resolve(); }
    return Pref.remove({ key: key });
  }
};

// ── EXPORT ALL ──────────────────────────────────────────────────
window.OBNative = {
  isNative: isNative,
  getPlatform: getPlatform,
  haptics: OBHaptics,
  biometric: OBBiometric,
  appleSignIn: OBAppleSignIn,
  googleSignIn: OBGoogleSignIn,
  push: OBPushNotifications,
  localNotifications: OBLocalNotifications,
  shortcuts: OBAppShortcuts,
  camera: OBCamera,
  share: OBShare,
  network: OBNetwork,
  database: OBDatabase,
  siri: OBSiri,
  widgets: OBWidgets,
  liveActivity: OBLiveActivity,
  health: OBHealth,
  speech: OBSpeech,
  lifecycle: OBAppLifecycle,
  screen: OBScreen,
  statusBar: OBStatusBar,
  preferences: OBPreferences,
  store: OBStore,
  review: OBReview
};

// ── Set up window._purchases for app.jsx to consume ────────────
// The app uses window._purchases.checkEntitlements(), .getProduct(), .purchase(), .restore()
if (isNative()) {
  window._purchases = {
    checkEntitlements: OBStore.checkEntitlements,
    getProduct: OBStore.getProduct,
    purchase: OBStore.purchase,
    restore: OBStore.restore,
    getProducts: OBStore.getProducts
  };
}

// ── AUTO-INIT on native ─────────────────────────────────────────
// Guard: only run once per page load to prevent double-init
// (Capacitor WKWebView + service worker can cause scripts to re-execute)
if (isNative() && !window.__obNativeInitDone) {
  window.__obNativeInitDone = true;
  (function() {
    try {
      // Lock to portrait
      OBScreen.lockPortrait();
      // Init SQLite
      OBDatabase.init();
      // Create Android notification channels
      OBLocalNotifications.createChannels();
      // Set up app shortcuts
      OBAppShortcuts.set([
        { id: 'log_feed', title: 'Log Feed', description: 'Quickly log a feed' },
        { id: 'log_sleep', title: 'Log Sleep', description: 'Log sleep or nap' },
        { id: 'log_nappy', title: 'Log Nappy', description: 'Log a nappy change' },
        { id: 'start_timer', title: 'Start Timer', description: 'Start feed or sleep timer' }
      ]);
      // Donate Siri shortcuts
      if (getPlatform() === 'ios') {
        OBSiri.donateAllShortcuts();
      }
      // Widget data managed by main app — skip legacy sender
      // Preload store products so paywall opens instantly
      OBStore.getProducts();
    } catch(e) {
      console.warn('Native init error:', e);
    }
  })();
}
