export const emailTemplates = {
  fr: {
    magicLink: {
      subject: 'Votre lien de connexion',
      body: (link: string) =>
        `<p>Cliquez sur le lien ci-dessous pour vous connecter. Il expirera dans 15 minutes.</p>
         <a href="${link}">Se connecter</a>`
    }
  },
  en: {
    magicLink: {
      subject: 'Your sign-in link',
      body: (link: string) =>
        `<p>Click the link below to sign in. It will expire in 15 minutes.</p>
         <a href="${link}">Sign in</a>`
    }
  }
}
