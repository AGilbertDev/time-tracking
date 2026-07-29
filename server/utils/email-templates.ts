import { APP_NAME } from '#shared/brand'

// Transactional email copy. French uses a space before ? ! : ; per the project convention.
// The user is a professional translator, so every string here is a proposal pending
// owner verification, kept clear and transactional rather than marketing copy. Each message names
// the product (APP_NAME) so a recipient knows which app it is from, since a personal sender name
// alone does not tell them. A clear real sender identity is carried through sendEmail
// (from-address), satisfying the CASL / CAN-SPAM baseline.
export const emailTemplates = {
  fr: {
    magicLink: {
      subject: `Votre lien pour créer votre compte ${APP_NAME}`,
      body: (link: string) =>
        `<p>Cliquez sur le lien ci-dessous pour créer votre compte ${APP_NAME}. Il expirera dans 15 minutes.</p>
         <p>Si le lien expire, remplissez de nouveau le formulaire de création de compte pour en recevoir un nouveau.</p>
         <a href="${link}">Créer mon compte</a>`
    },
    // Localized deactivation notice, chosen by the target user's persisted locale. The contact
    // address is passed in from runtimeConfig so it lives in config, not here.
    accountDeactivated: {
      subject: `Votre compte ${APP_NAME} a été désactivé`,
      body: (contactEmail: string) =>
        `<p>Bonjour,</p>
         <p>Votre compte ${APP_NAME} a été désactivé et vous n'y avez plus accès.</p>
         <p>Pour toute question, écrivez à <a href="mailto:${contactEmail}">${contactEmail}</a>.</p>`
    }
  },
  en: {
    magicLink: {
      subject: `Your link to create your ${APP_NAME} account`,
      body: (link: string) =>
        `<p>Click the link below to create your ${APP_NAME} account. It will expire in 15 minutes.</p>
         <p>If the link expires, fill out the account creation form again to receive a new one.</p>
         <a href="${link}">Create my account</a>`
    },
    accountDeactivated: {
      subject: `Your ${APP_NAME} account has been deactivated`,
      body: (contactEmail: string) =>
        `<p>Hello,</p>
         <p>Your ${APP_NAME} account has been deactivated and you no longer have access.</p>
         <p>If you have any questions, write to <a href="mailto:${contactEmail}">${contactEmail}</a>.</p>`
    }
  },
  // Invitation is a single fully bilingual message (French first, then English) because an invited
  // person has no persisted locale yet. One call-to-action link points at the signup page, where
  // the existing magic-link allowlist gate takes over. Subject and body are proposals pending
  // owner verification.
  invite: {
    subject: `Invitation à créer votre compte ${APP_NAME} | Invitation to create your ${APP_NAME} account`,
    body: (signupUrl: string) =>
      `<p>Bonjour,</p>
       <p>Vous avez été invité à utiliser ${APP_NAME}. Cliquez sur le lien ci-dessous pour créer votre compte.</p>
       <p><a href="${signupUrl}">Créer mon compte</a></p>
       <p>Si vous n'attendiez pas cette invitation, vous pouvez ignorer ce message.</p>
       <hr />
       <p>Hello,</p>
       <p>You have been invited to use ${APP_NAME}. Click the link below to create your account.</p>
       <p><a href="${signupUrl}">Create my account</a></p>
       <p>If you were not expecting this invitation, you can ignore this message.</p>`
  }
}
