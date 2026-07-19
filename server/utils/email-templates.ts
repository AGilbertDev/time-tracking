export const emailTemplates = {
  fr: {
    magicLink: {
      subject: 'Votre lien pour créer votre compte',
      body: (link: string) =>
        `<p>Cliquez sur le lien ci-dessous pour créer votre compte. Il expirera dans 15 minutes.</p>
         <p>Si le lien expire, remplissez de nouveau le formulaire de création de compte pour en recevoir un nouveau.</p>
         <a href="${link}">Créer mon compte</a>`
    }
  },
  en: {
    magicLink: {
      subject: 'Your link to create your account',
      body: (link: string) =>
        `<p>Click the link below to create your account. It will expire in 15 minutes.</p>
         <p>If the link expires, fill out the account creation form again to receive a new one.</p>
         <a href="${link}">Create my account</a>`
    }
  }
}
