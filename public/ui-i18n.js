const UI_I18N = {
  en: {
    app_tagline: 'Interactive Bebras tasks with move-based scoring',
    not_logged_in: 'Not logged in',
    logged_in_as: 'Logged in as {username}{rolePart}',
    logout: 'Logout',
    login: 'Login',
    username: 'Username',
    password: 'Password',
    role: 'Role',
    teacher: 'Teacher',
    register: 'Register',
    students_cannot_register: 'Students cannot register. Teachers create student accounts and distribute logins.',
    teacher_coordinator: 'Teacher Coordinator',
    paste_csv: 'Paste CSV (one student name per line, or first column = name)',
    upload_csv_generate: 'Upload CSV & Generate Credentials',
    all_student_credentials: 'All Student Credentials (always available)',
    refresh_credentials: 'Refresh Credentials',
    refresh_marks: 'Refresh Marks',
    download_excel_csv: 'Download Excel (CSV)',
    student_marks_preview: 'Student Marks (Detailed Preview)',
    test_session: 'Test session',
    attempt: 'Attempt',
    start_exam: 'Start Exam',
    end: 'End',
    task: 'Task',
    maximize: 'Maximize',
    finish_task: 'Finish task',
    host_page_hint:
      "This host page loads the task in an iframe. The task sends move events to the host, which logs them to the server with penalties.",

    // alerts / runtime strings
    start_exam_first: 'Start the exam first.',
    game_already_finished: 'This game is already finished.',
    exam_resumed: 'Exam resumed. Timer continued from your original start time.',
    teacher_cannot_start: 'Teacher accounts cannot start student exams.',
    exam_already_started: 'Exam already started for this account.',
    exam_started: 'Exam started. You have 45 minutes.',
    time_up_auto_submit: 'Time is up. Challenge submitted automatically.',
    challenge_submitted: 'Challenge submitted.',
    could_not_submit: 'Could not submit challenge right now.',
    already_completed_only_attempt: 'You already completed your only attempt.',
    could_not_start_exam: 'Could not start exam: {err}',
    game_finished: 'Game finished',

    login_failed: 'Login failed: {err}',
    registered_now_login: 'Registered. Now click Login.',
    register_failed: 'Register failed: {err}',

    marks_refreshed: 'Marks refreshed.',
    could_not_load_marks: 'Could not load marks: {err}',
    credentials_refreshed: 'Credentials refreshed.',
    could_not_load_credentials: 'Could not load credentials: {err}',
    upload_failed: 'Upload failed: {err}',
    created_student_accounts: 'Created {count} student accounts.',
    could_not_download: 'Could not download: {err}'
  },
  de: {
    app_tagline: 'Interaktive Bebras-Aufgaben mit zugbasierter Auswertung',
    not_logged_in: 'Nicht eingeloggt',
    logged_in_as: 'Eingeloggt als {username}{rolePart}',
    logout: 'Abmelden',
    login: 'Anmelden',
    username: 'Benutzername',
    password: 'Passwort',
    role: 'Rolle',
    teacher: 'Lehrer',
    register: 'Registrieren',
    students_cannot_register:
      'Schüler können sich nicht registrieren. Lehrkräfte erstellen Schülerkonten und verteilen die Logins.',
    teacher_coordinator: 'Lehrerbereich',
    paste_csv: 'CSV einfügen (ein Name pro Zeile oder erste Spalte = Name)',
    upload_csv_generate: 'CSV hochladen & Zugangsdaten erstellen',
    all_student_credentials: 'Alle Zugangsdaten der Schüler (immer verfügbar)',
    refresh_credentials: 'Zugangsdaten aktualisieren',
    refresh_marks: 'Ergebnisse aktualisieren',
    download_excel_csv: 'Excel (CSV) herunterladen',
    student_marks_preview: 'Schülerübersicht (detaillierte Vorschau)',
    test_session: 'Testsitzung',
    attempt: 'Versuch',
    start_exam: 'Prüfung starten',
    end: 'Beenden',
    task: 'Aufgabe',
    maximize: 'Maximieren',
    finish_task: 'Aufgabe beenden',
    host_page_hint:
      'Diese Host-Seite lädt die Aufgabe in einem iFrame. Die Aufgabe sendet Ereignisse an den Host, der sie mit Strafwerten protokolliert.',

    start_exam_first: 'Starte zuerst die Prüfung.',
    game_already_finished: 'Diese Aufgabe ist bereits beendet.',
    exam_resumed: 'Prüfung fortgesetzt. Der Timer läuft ab dem ursprünglichen Start weiter.',
    teacher_cannot_start: 'Lehrkonten können keine Schülerprüfung starten.',
    exam_already_started: 'Für dieses Konto wurde die Prüfung bereits gestartet.',
    exam_started: 'Prüfung gestartet. Du hast 45 Minuten.',
    time_up_auto_submit: 'Zeit ist abgelaufen. Die Prüfung wurde automatisch abgegeben.',
    challenge_submitted: 'Prüfung abgegeben.',
    could_not_submit: 'Abgabe momentan nicht möglich.',
    already_completed_only_attempt: 'Du hast deinen einzigen Versuch bereits abgeschlossen.',
    could_not_start_exam: 'Prüfung konnte nicht gestartet werden: {err}',
    game_finished: 'Spiel beendet',

    login_failed: 'Anmeldung fehlgeschlagen: {err}',
    registered_now_login: 'Registriert. Klicke jetzt auf „Anmelden“.',
    register_failed: 'Registrierung fehlgeschlagen: {err}',

    marks_refreshed: 'Ergebnisse aktualisiert.',
    could_not_load_marks: 'Ergebnisse konnten nicht geladen werden: {err}',
    credentials_refreshed: 'Zugangsdaten aktualisiert.',
    could_not_load_credentials: 'Zugangsdaten konnten nicht geladen werden: {err}',
    upload_failed: 'Upload fehlgeschlagen: {err}',
    created_student_accounts: '{count} Schülerkonten erstellt.',
    could_not_download: 'Download fehlgeschlagen: {err}'
  },
  ar: {
    app_tagline: 'مهام بيبراس تفاعلية مع تتبّع الحركات',
    not_logged_in: 'غير مسجّل الدخول',
    logged_in_as: 'مسجّل الدخول باسم {username}{rolePart}',
    logout: 'تسجيل الخروج',
    login: 'تسجيل الدخول',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    role: 'الدور',
    teacher: 'معلّم',
    register: 'تسجيل',
    students_cannot_register: 'لا يمكن للطلاب التسجيل. يقوم المعلمون بإنشاء حسابات الطلاب وتوزيع بيانات الدخول.',
    teacher_coordinator: 'لوحة المعلم',
    paste_csv: 'الصق CSV (اسم طالب في كل سطر، أو العمود الأول = الاسم)',
    upload_csv_generate: 'رفع CSV وإنشاء بيانات الدخول',
    all_student_credentials: 'بيانات دخول جميع الطلاب (متاحة دائمًا)',
    refresh_credentials: 'تحديث بيانات الدخول',
    refresh_marks: 'تحديث النتائج',
    download_excel_csv: 'تحميل Excel (CSV)',
    student_marks_preview: 'نتائج الطلاب (معاينة تفصيلية)',
    test_session: 'جلسة الاختبار',
    attempt: 'المحاولة',
    start_exam: 'بدء الاختبار',
    end: 'إنهاء',
    task: 'المهمة',
    maximize: 'تكبير',
    finish_task: 'إنهاء المهمة',
    host_page_hint:
      'تقوم صفحة الاستضافة بتحميل المهمة داخل إطار. ترسل المهمة الأحداث إلى الاستضافة التي تقوم بتسجيلها على الخادم مع العقوبات.',

    start_exam_first: 'ابدأ الاختبار أولاً.',
    game_already_finished: 'تم إنهاء هذه المهمة بالفعل.',
    exam_resumed: 'تم استئناف الاختبار. استمر المؤقت من وقت البدء الأصلي.',
    teacher_cannot_start: 'حسابات المعلم لا يمكنها بدء اختبار الطلاب.',
    exam_already_started: 'تم بدء الاختبار لهذا الحساب بالفعل.',
    exam_started: 'تم بدء الاختبار. لديك 45 دقيقة.',
    time_up_auto_submit: 'انتهى الوقت. تم إرسال الاختبار تلقائيًا.',
    challenge_submitted: 'تم إرسال الاختبار.',
    could_not_submit: 'تعذّر إرسال الاختبار الآن.',
    already_completed_only_attempt: 'لقد أكملت محاولتك الوحيدة بالفعل.',
    could_not_start_exam: 'تعذّر بدء الاختبار: {err}',
    game_finished: 'تم إنهاء اللعبة',

    login_failed: 'فشل تسجيل الدخول: {err}',
    registered_now_login: 'تم التسجيل. الآن اضغط تسجيل الدخول.',
    register_failed: 'فشل التسجيل: {err}',

    marks_refreshed: 'تم تحديث النتائج.',
    could_not_load_marks: 'تعذّر تحميل النتائج: {err}',
    credentials_refreshed: 'تم تحديث بيانات الدخول.',
    could_not_load_credentials: 'تعذّر تحميل بيانات الدخول: {err}',
    upload_failed: 'فشل الرفع: {err}',
    created_student_accounts: 'تم إنشاء {count} حساب طالب.',
    could_not_download: 'تعذّر التحميل: {err}'
  }
};

export function currentUiLang() {
  const el = document.querySelector('#translateLang');
  const lang = el?.value || 'en';
  return lang === 'de' || lang === 'ar' ? lang : 'en';
}

export function uiT(key, vars = {}, lang = currentUiLang()) {
  const dict = UI_I18N[lang] ?? UI_I18N.en;
  const tpl = dict[key] ?? UI_I18N.en[key] ?? key;
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

export function applyUiI18n(lang = currentUiLang()) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

  // Elements with data-i18n / data-i18n-placeholder
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (!k) return;
    el.textContent = uiT(k, {}, lang);
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const k = el.getAttribute('data-i18n-html');
    if (!k) return;
    el.innerHTML = uiT(k, {}, lang);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const k = el.getAttribute('data-i18n-placeholder');
    if (!k) return;
    el.setAttribute('placeholder', uiT(k, {}, lang));
  });
}

