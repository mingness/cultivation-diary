/**
 * The profile (spec §4.4): photo (300 × 300, made in the browser), names, address, email and phone. A
 * mantra-only account (COUNT_USER) has a display name, email and phone only, and must keep one of the two.
 */
import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Email, ErrorCode, hasContact, isPhone } from '@diary/shared';
import { useSaveProfile } from '../../api/account.js';
import { ApiError } from '../../api/client.js';
import { useMe } from '../../api/session.js';
import { Button } from '../../components/Button.js';
import { TextField } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import { prepareAvatar } from '../../lib/avatar.js';
import styles from './AccountScreen.module.css';

export function ProfileSection() {
  const { t, tError } = useI18n();
  const me = useMe();
  const toast = useToast();
  const save = useSaveProfile();
  const [profile, setProfile] = useState(me.profile);
  const [email, setEmail] = useState(me.email ?? '');
  const [checked, setChecked] = useState(false);
  const mantraOnly = me.role === 'COUNT_USER';
  const emailBad = email.trim() !== '' && !Email.safeParse(email.trim()).success;
  const phoneBad = profile.phone.trim() !== '' && !isPhone(profile.phone.trim());
  const contactMissing = mantraOnly && !hasContact(email, profile.phone);

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const photo = await prepareAvatar(file);
      setProfile((p) => ({ ...p, photo }));
    } catch {
      toast.show(t('editor.imageUnreadable'));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (emailBad || phoneBad || contactMissing) return;
    save.mutate(
      {
        email: email.trim() || null,
        profile: {
          ...profile,
          familyName: profile.familyName.trim(),
          givenName: profile.givenName.trim(),
          address: profile.address.trim(),
          phone: profile.phone.trim(),
        },
      },
      { onSuccess: () => toast.show(t('account.profileSaved')) },
    );
  }

  const error = save.error instanceof ApiError ? save.error : null;
  return (
    <section className={styles.section} aria-labelledby="profile-heading">
      <h2 id="profile-heading">{t('account.profile')}</h2>
      <form className={styles.form} onSubmit={submit} noValidate>
        {mantraOnly ? (
          <TextField
            label={t('register.displayName')}
            hint={t('register.displayNameHint')}
            optional
            maxLength={50}
            value={profile.givenName}
            onChange={(e) => setProfile((p) => ({ ...p, givenName: e.target.value }))}
          />
        ) : (
          <>
            <div className={styles.photoRow}>
              {profile.photo ? (
                <img className={styles.avatar} src={profile.photo} alt="" />
              ) : (
                <span className={styles.avatar} aria-hidden="true" />
              )}
              <label className={styles.fileButton}>
                {t('userForm.choosePhoto')}
                <input
                  type="file"
                  accept="image/*"
                  className="visually-hidden"
                  onChange={(e) => void choosePhoto(e)}
                />
              </label>
              {profile.photo && (
                <Button
                  small
                  variant="quiet"
                  onClick={() => setProfile((p) => ({ ...p, photo: null }))}
                >
                  {t('userForm.removePhoto')}
                </Button>
              )}
            </div>
            <div className={styles.names}>
              <TextField
                label={t('register.familyName')}
                optional
                maxLength={50}
                value={profile.familyName}
                onChange={(e) => setProfile((p) => ({ ...p, familyName: e.target.value }))}
              />
              <TextField
                label={t('register.givenName')}
                optional
                maxLength={50}
                value={profile.givenName}
                onChange={(e) => setProfile((p) => ({ ...p, givenName: e.target.value }))}
              />
            </div>
            <TextField
              label={t('register.address')}
              optional
              maxLength={200}
              value={profile.address}
              onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
            />
          </>
        )}
        {mantraOnly && <p className={styles.username}>{t('register.contactHint')}</p>}
        <TextField
          label={t('register.email')}
          optional={!mantraOnly}
          type="email"
          maxLength={200}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={
            error?.code === ErrorCode.EmailTaken
              ? tError(error.code)
              : checked && emailBad
                ? t('register.badEmail')
                : null
          }
        />
        <TextField
          label={t('register.phone')}
          optional={!mantraOnly}
          type="tel"
          autoComplete="tel"
          maxLength={30}
          value={profile.phone}
          onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
          error={
            checked && phoneBad
              ? t('register.badPhone')
              : checked && contactMissing
                ? t('register.contactRequired')
                : null
          }
        />
        {error && error.code !== ErrorCode.EmailTaken && (
          <Notice kind="error" requestId={error.requestId}>
            {tError(error.code)}
          </Notice>
        )}
        <div>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {t('account.saveProfile')}
          </Button>
        </div>
      </form>
    </section>
  );
}
