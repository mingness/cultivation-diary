/**
 * Self-registration (spec §4.2, D30): creates a mantra-only account (COUNT_USER), with an email or a phone
 * (at least one) and no verification. On success the user goes to sign-in with their username filled in.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Email, ErrorCode, hasContact, isPhone, Password, Username } from '@diary/shared';
import { useAuthOptions } from '../../api/auth.js';
import { ApiError, api } from '../../api/client.js';
import { AuthLayout } from '../../components/AuthLayout.js';
import { Button } from '../../components/Button.js';
import { PasswordField, TextField } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { useI18n, type MessageKey } from '../../i18n/index.js';
import { CaptchaField, useCaptcha } from './Captcha.js';
import type { LoginLocationState } from './LoginScreen.js';
import styles from './auth.module.css';

interface Form {
  username: string;
  displayName: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
  answer: string;
}

type Field = keyof Form;
type Problems = Partial<Record<Field, MessageKey>>;

const EMPTY: Form = {
  username: '',
  displayName: '',
  email: '',
  phone: '',
  password: '',
  confirm: '',
  answer: '',
};

/** The same rules the server applies, checked first so the user sees them next to the field. */
export function checkRegistration(form: Form): Problems {
  const problems: Problems = {};
  if (!Username.safeParse(form.username).success) problems.username = 'register.badUsername';
  if (!Password.safeParse(form.password).success) problems.password = 'register.badPassword';
  else if (form.password !== form.confirm) problems.confirm = 'register.mismatch';
  const email = form.email.trim();
  const phone = form.phone.trim();
  if (email && !Email.safeParse(email).success) problems.email = 'register.badEmail';
  if (phone && !isPhone(phone)) problems.phone = 'register.badPhone';
  else if (!hasContact(email, phone)) problems.phone = 'register.contactRequired';
  if (!form.answer) problems.answer = 'auth.required';
  return problems;
}

export function RegisterScreen() {
  const { t } = useI18n();
  const options = useAuthOptions();
  if (options.data?.registration === false) {
    return (
      <AuthLayout>
        <h1>{t('register.title')}</h1>
        <Notice kind="info">{t('register.closed')}</Notice>
        <div className={styles.links}>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </div>
      </AuthLayout>
    );
  }
  return <RegisterForm />;
}

function RegisterForm() {
  const { t, tError } = useI18n();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [problems, setProblems] = useState<Problems>({});
  const { captcha, failed, refresh } = useCaptcha();

  const register = useMutation({
    mutationFn: (body: object) => api('POST', '/api/auth/register', body),
    onSuccess: () => {
      const state: LoginLocationState = { registered: form.username.trim() };
      void navigate('/login', { state });
    },
    onError: (error) => {
      setForm((f) => ({ ...f, answer: '' }));
      refresh();
      // These two belong next to their field rather than above the button.
      if (error instanceof ApiError && error.code === ErrorCode.UsernameTaken) {
        setProblems({ username: 'error.username_taken' });
      } else if (error instanceof ApiError && error.code === ErrorCode.EmailTaken) {
        setProblems({ email: 'error.email_taken' });
      }
    },
  });

  const set = (field: Field) => (event: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: event.target.value }));

  function problem(field: Field): string | null {
    const key = problems[field];
    if (!key) return null;
    return key === 'auth.required' ? t(key, { field: t('auth.captchaAnswer') }) : t(key);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = checkRegistration(form);
    setProblems(found);
    if (Object.keys(found).length > 0 || !captcha) return;
    register.mutate({
      username: form.username.trim(),
      password: form.password,
      displayName: form.displayName.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim(),
      captchaId: captcha.id,
      captchaAnswer: form.answer,
    });
  }

  const error = register.error instanceof ApiError ? register.error : null;
  const fieldError =
    error?.code === ErrorCode.UsernameTaken || error?.code === ErrorCode.EmailTaken;

  return (
    <AuthLayout>
      <form className={styles.form} onSubmit={submit} noValidate>
        <h1>{t('register.title')}</h1>
        <TextField
          label={t('auth.username')}
          hint={t('register.usernameHint')}
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={32}
          value={form.username}
          onChange={set('username')}
          error={problem('username')}
        />
        <TextField
          label={t('register.displayName')}
          hint={t('register.displayNameHint')}
          optional
          autoComplete="nickname"
          maxLength={50}
          value={form.displayName}
          onChange={set('displayName')}
        />
        <p className={styles.intro}>{t('register.contactHint')}</p>
        <TextField
          label={t('register.email')}
          type="email"
          autoComplete="email"
          maxLength={200}
          value={form.email}
          onChange={set('email')}
          error={problem('email')}
        />
        <TextField
          label={t('register.phone')}
          type="tel"
          autoComplete="tel"
          maxLength={30}
          value={form.phone}
          onChange={set('phone')}
          error={problem('phone')}
        />
        <PasswordField
          label={t('auth.password')}
          hint={t('register.passwordHint')}
          autoComplete="new-password"
          maxLength={256}
          value={form.password}
          onChange={set('password')}
          error={problem('password')}
        />
        <PasswordField
          label={t('register.confirmPassword')}
          autoComplete="new-password"
          maxLength={256}
          value={form.confirm}
          onChange={set('confirm')}
          error={problem('confirm')}
        />
        <CaptchaField
          captcha={captcha}
          failed={failed}
          onRefresh={refresh}
          answer={form.answer}
          onAnswer={(answer) => setForm((f) => ({ ...f, answer }))}
          error={problem('answer')}
        />
        {error && !fieldError && (
          <Notice kind="error" requestId={error.requestId}>
            {tError(error.code)}
          </Notice>
        )}
        <Button type="submit" variant="primary" wide disabled={register.isPending || !captcha}>
          {register.isPending ? t('register.submitting') : t('register.submit')}
        </Button>
        <div className={styles.links}>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
