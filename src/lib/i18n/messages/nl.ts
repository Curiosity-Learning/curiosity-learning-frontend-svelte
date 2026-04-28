const nl = {
	common: {
		appName: 'Curiosity Learning',
		goBack: 'Ga terug',
		newSignUp: 'Ik ben nieuw, meld me aan',
		iHaveAccount: 'Ik heb al een account',
		next: 'Volgende',
		continue: 'Doorgaan',
		change: 'Wijzigen',
		verify: 'Verifiëren',
		resend: 'Opnieuw verzenden',
		browse: 'Bladeren',
		noImage: 'Geen afbeelding',
		checkEmail: 'Controleer je e-mail',
		checking: 'Controleren...',
		saving: 'Opslaan...',
		finishing: 'Afronden...',
		loading: 'Laden...',
		lastUpdatedOn: 'Laatst bijgewerkt op {date}',
		months: {
			january: 'Januari',
			february: 'Februari',
			march: 'Maart',
			april: 'April',
			may: 'Mei',
			june: 'Juni',
			july: 'Juli',
			august: 'Augustus',
			september: 'September',
			october: 'Oktober',
			november: 'November',
			december: 'December'
		}
	},
	legal: {
		privacyTitle: 'Privacybeleid',
		termsTitle: 'Algemene voorwaarden',
		cookiesTitle: 'Cookiebeleid',
		privacyEmpty: 'Er is nog geen inhoud voor het privacybeleid ingesteld.',
		termsEmpty: 'Er is nog geen inhoud voor de algemene voorwaarden ingesteld.',
		cookiesEmpty: 'Er is nog geen inhoud voor het cookiebeleid ingesteld.'
	},
	mediaUpload: {
		failedBeforeStorage: 'Uploaden is mislukt voordat het bestand de opslag bereikte.',
		missingStorageReference: 'Uploaden is voltooid, maar er is geen opslagverwijzing teruggekomen.'
	},
	settings: {
		language: {
			label: 'Taal',
			english: 'Engels',
			dutch: 'Nederlands'
		}
	},
	settingsPage: {
		errorTitle: 'Bijwerken van instellingen mislukt',
		successTitle: 'Opgeslagen',
		policiesTitle: 'Beleidsdocumenten',
		policiesDescription: 'Privacy-, voorwaarden- en cookie-informatie.',
		openPrivacyPolicy: 'Open privacybeleid',
		openTerms: 'Open algemene voorwaarden',
		openCookies: 'Open cookiebeleid',
		profileImageUploaded: 'Profielafbeelding geüpload.',
		profileImageUploadFailure: 'Kan profielafbeelding niet uploaden.',
		profileUpdated: 'Profiel bijgewerkt.',
		saveProfileFailure: 'Kan profiel niet opslaan.',
		preferencesSaved: 'Voorkeuren opgeslagen.',
		savePreferencesFailure: 'Kan voorkeuren niet opslaan.',
		activeClubUpdated: 'Actieve club bijgewerkt.',
		switchClubFailure: 'Wisselen van club mislukt.'
	},
	authLayout: {
		description: 'Log in om verder te gaan met je clubervaring.'
	},
	auth: {
		signIn: {
			title: 'Log in',
			illustrationAlt: 'Illustratie voor inloggen',
			identifierLabel: 'Gebruikersnaam of e-mail',
			identifierPlaceholder: 'Voer je gebruikersnaam of e-mail in',
			passwordLabel: 'Wachtwoord',
			passwordPlaceholder: 'Voer je wachtwoord in',
			hidePassword: 'Verberg wachtwoord',
			showPassword: 'Toon wachtwoord',
			rememberMe: 'Houd me 30 dagen ingelogd',
			forgotPassword: 'Wachtwoord vergeten?',
			submit: 'Log in',
			submitting: 'Bezig met inloggen...',
			continueWithGoogle: 'Doorgaan met Google',
			continuingWithGoogle: 'Bezig met doorgaan met Google...',
			resendVerification: 'Verificatie-e-mail opnieuw verzenden',
			errorTitle: 'Inloggen mislukt',
			googleStartFailed: 'Kon Google-inloggen niet starten.',
			googleStartFailedGeneric: 'Kon Google-inloggen niet starten.',
			genericFailure: 'Inloggen mislukt.',
			genericFailureRetry: 'Kan nu niet inloggen. Probeer het opnieuw.',
			invalidCredentials: 'Ongeldige gebruikersnaam, e-mail of wachtwoord.',
			parentConsentPending:
				'Een ouder of voogd moet dit account goedkeuren voordat je kunt inloggen.',
			invalidLoginTitle: 'Ongeldige login',
			invalidLoginDescription:
				'Voer een geldige gebruikersnaam of e-mail in en probeer het opnieuw.',
			resendIdentifierRequired:
				'Voer een geldige gebruikersnaam of e-mail in om de verificatie opnieuw te verzenden.',
			resendFailure: 'Kon de verificatie-e-mail niet opnieuw verzenden.',
			resendSuccess: 'Verificatie-e-mail verzonden. Controleer je inbox en spammap.',
			existingGoogleInfo:
				'Je hebt al een account met Google. Ga verder met Google om in te loggen.',
			existingGoogleTitle: 'Account bestaat al',
			existingGoogleDescription: 'Je hebt al een account met Google. We hebben je ingelogd.',
			existingGoogleJoinClub:
				'Dit Google-account is al geregistreerd. Log in om verder te gaan met het lid worden van deze club.',
			existingGoogleDefault:
				'Dit Google-account is al geregistreerd. Log in in plaats van je opnieuw aan te melden.',
			noAccountForEmail: 'Je hebt geen account met dat e-mailadres. Meld je aan om verder te gaan.',
			noAccountForGoogleEmail:
				'Je hebt geen account met dat Google-e-mailadres. Meld je aan om verder te gaan.',
			linkMismatch:
				'Dit Google-account kon hier niet worden gekoppeld. Log eerst in met je bestaande account of gebruik hetzelfde e-mailadres.',
			providerNotConfigured: 'Google-inloggen is nog niet ingesteld.',
			googleUnavailable: 'Kan nu niet doorgaan met Google. Probeer het opnieuw.'
		},
		resetPassword: {
			backToSignIn: 'Terug naar inloggen',
			requestTitle: 'Stel je wachtwoord opnieuw in',
			requestDescription:
				'Geen zorgen. Voer je gebruikersnaam of e-mail in en we sturen je instructies om je wachtwoord opnieuw in te stellen.',
			identifierLabel: 'Gebruikersnaam of e-mail',
			identifierPlaceholder: 'Voer je gebruikersnaam of e-mail in',
			submit: 'Wachtwoord opnieuw instellen',
			submitting: 'Verzenden...',
			requestErrorTitle: 'Kon resetlink niet verzenden',
			requestInvalidIdentifier: 'Voer een geldige gebruikersnaam of e-mail in.',
			requestFailure: 'Kon reset-e-mail niet verzenden.',
			tokenTitle: 'Maak een nieuw wachtwoord',
			newPasswordLabel: 'Nieuw wachtwoord',
			newPasswordPlaceholder: 'Voer je nieuwe wachtwoord in',
			confirmPasswordLabel: 'Bevestig wachtwoord',
			confirmPasswordPlaceholder: 'Bevestig je wachtwoord',
			hideNewPassword: 'Verberg nieuw wachtwoord',
			showNewPassword: 'Toon nieuw wachtwoord',
			hideConfirmPassword: 'Verberg bevestigd wachtwoord',
			showConfirmPassword: 'Toon bevestigd wachtwoord',
			saveErrorTitle: 'Kon wachtwoord niet opslaan',
			saveChanges: 'Wijzigingen opslaan',
			savingChanges: 'Opslaan...',
			passwordMismatch: 'Wachtwoorden komen niet overeen.',
			resetFailure: 'Kon wachtwoord niet opnieuw instellen.',
			passwordUpdatedTitle: 'Wachtwoord bijgewerkt',
			passwordUpdatedDescription: 'Je kunt nu inloggen met je nieuwe wachtwoord.',
			emailSentTitle: 'Link voor wachtwoordherstel verzonden',
			emailSentParent:
				'We hebben een e-mail gestuurd naar het account van je ouder of voogd. Vraag hen om op de link in de e-mail te klikken om je wachtwoord opnieuw in te stellen.',
			emailSentDefault:
				'We hebben een e-mail gestuurd naar je account. Klik op de link in de e-mail om je wachtwoord opnieuw in te stellen.',
			checkSpam: 'Zie je de e-mail niet? Controleer dan je spammap.',
			emailSentIllustrationAlt: 'E-mail voor wachtwoordherstel verzonden'
		},
		signUp: {
			existingGoogleJoinClub:
				'Dit Google-account is al geregistreerd. Log in om verder te gaan met het lid worden van deze club.',
			existingGoogleDefault:
				'Dit Google-account is al geregistreerd. Log in in plaats van je opnieuw aan te melden.',
			existingInlineUnverified:
				'Er bestaat al een account met dit e-mailadres dat nog e-mailverificatie nodig heeft. Ga verder en we sturen je terug naar de verificatiestap.',
			existingInlineResumeGoogle:
				'Er bestaat al een Google-account met dit e-mailadres en de aanmelding is nog niet afgerond. Ga verder met Google om je gebruikersnaam- en pledge-stappen te hervatten.',
			existingInlineResumeLogin:
				'Dit e-mailadres is al geverifieerd, maar de aanmelding is nog niet afgerond. Ga naar inloggen om je gebruikersnaam- en pledge-stappen te hervatten.',
			existingInlineGoogleRegistered:
				'Dit e-mailadres is al geregistreerd met Google. Ga verder met Google om in te loggen.',
			existingInlineRegistered:
				'Dit e-mailadres is al geregistreerd. Ga naar inloggen om verder te gaan.',
			existingVerifiedResume:
				'Dit e-mailadres is al geverifieerd. Log in om je gebruikersnaam- en pledge-stappen af te ronden.',
			existingRegisteredSignIn: 'Dit e-mailadres is al geregistreerd. Log in om verder te gaan.',
			existingManualGoogleResume:
				'Er bestaat al een Google-account met dit e-mailadres. Ga verder met Google om je aanmelding af te ronden.',
			existingManualGoogleSignIn:
				'Dit e-mailadres is al geregistreerd met Google. Ga verder met Google om in te loggen.',
			existingBelongsResume:
				'Dit e-mailadres hoort al bij een bestaand account. Log in om je gebruikersnaam- en pledge-stappen af te ronden.',
			existingBelongsSignIn:
				'Dit e-mailadres is al geregistreerd. Log in op je bestaande account om verder te gaan.',
			continueSignupTitle: 'Ga verder met je aanmelding',
			accountExistsTitle: 'Account bestaat al',
			verificationCodeSentTitle: 'Verificatiecode verzonden',
			verificationCodeSentDescription: 'Controleer je inbox voor de nieuwste code.',
			failedSendVerificationCode: 'Kon verificatiecode niet verzenden.',
			completeRequiredFields: 'Vul alle verplichte velden in voordat je verdergaat.',
			acceptTerms: 'Accepteer de algemene voorwaarden om verder te gaan.',
			passwordsMismatch: 'Wachtwoorden komen niet overeen.',
			failedCreateAccount: 'Kon account niet aanmaken.',
			registeredSignInInstead: 'Dit e-mailadres is al geregistreerd. Log alsjeblieft in.',
			verificationCodeSentToEmail:
				'We hebben een nieuwe 6-cijferige verificatiecode gestuurd naar {email}.',
			verificationCodeInitialToEmail:
				'We hebben een 6-cijferige verificatiecode gestuurd naar {email}.',
			googleOnlyOver16:
				'Aanmelden met Google is alleen beschikbaar voor gebruikers ouder dan 16 jaar.',
			failedContinueWithGoogle: 'Kon niet verdergaan met Google.',
			failedStartGoogleSignUp: 'Kon aanmelden met Google niet starten.',
			emailResentInfo: 'Er is een nieuwe verificatiecode verzonden.',
			emailResentTitle: 'E-mail opnieuw verzonden',
			emailResentDescription: 'We hebben de e-mail opnieuw verzonden. Controleer je inbox.',
			enterCompleteCode: 'Voer de volledige verificatiecode van 6 cijfers in.',
			emailAlreadyVerifiedFinalizing: 'E-mail is al geverifieerd. Je account wordt afgerond...',
			invalidVerificationCode: 'Ongeldige verificatiecode.',
			emailVerifiedFinalizing:
				'E-mail geverifieerd. Je account wordt afgerond. Dit kan enkele seconden duren...',
			unableSaveProfile: 'Kan profielgegevens niet opslaan. Probeer het opnieuw.',
			postVerifyDelayed:
				'We hebben je e-mail geverifieerd, maar het afronden van je account duurt langer dan verwacht. Wacht even en tik opnieuw op Verifiëren.',
			emailVerifiedTitle: 'E-mail geverifieerd',
			emailVerifiedDescription:
				'We wachten nog tot je sessie klaar is met synchroniseren. Probeer over een ogenblik opnieuw op Verifiëren te tikken.',
			unableFinishGoogleSignup: 'Kon aanmelden met Google niet afronden. Probeer het opnieuw.',
			existingGoogleSignedInDescription:
				'Je hebt al een account met Google. We hebben je ingelogd.',
			successAlt: 'Succesvolle accountverificatie',
			successTitle: 'Hoera!',
			successDescription: 'Je e-mailaccount is succesvol aangemaakt en geverifieerd.',
			existingGoogleProcessingTitle: 'Je wordt ingelogd',
			existingGoogleProcessingDescription:
				'Dit Google-account bestaat al. We gaan verder met je bestaande account.',
			googlePostProcessingTitle: 'Je Google-account wordt gekoppeld',
			googlePostProcessingDescription: 'Je aanmelding wordt afgerond. Dit duurt maar even.',
			personalTitle: 'Voer je persoonlijke gegevens in',
			dateOfBirth: 'Geboortedatum',
			cannotContinueTitle: 'Kan nog niet doorgaan',
			accountTitle: 'Voer je accountgegevens in',
			agreeTo: 'Ik ga akkoord met de',
			termsAndConditions: 'Algemene voorwaarden',
			continueWithGoogle: 'Doorgaan met Google',
			continuingWithGoogle: 'Bezig met doorgaan met Google...',
			parentEmailLabel: 'E-mailadres van je ouder of voogd',
			emailLabel: 'E-mail',
			emailPlaceholder: 'john.doe@gmail.com',
			parentEmailDescription:
				'We zijn enthousiast om je te laten starten, maar we moeten je ouder of voogd informeren over je account.',
			checkingEmail: 'Dit e-mailadres wordt gecontroleerd...',
			checkingUsername: 'Deze gebruikersnaam wordt gecontroleerd...',
			usernameAvailable: 'Gebruikersnaam is beschikbaar.',
			usernameTaken: 'Deze gebruikersnaam is al in gebruik.',
			usernameCheckFailed: 'Kon deze gebruikersnaam niet controleren. Probeer het opnieuw.',
			waitForUsernameCheck: 'Wacht tot de gebruikersnaamcontrole klaar is.',
			accountFoundTitle: 'Account gevonden',
			passwordLabel: 'Wachtwoord',
			passwordPlaceholder: 'Voer je wachtwoord in',
			hidePassword: 'Verberg wachtwoord',
			showPassword: 'Toon wachtwoord',
			confirmPasswordLabel: 'Bevestig wachtwoord',
			confirmPasswordPlaceholder: 'Voer je wachtwoord opnieuw in',
			hideConfirmPassword: 'Verberg bevestigd wachtwoord',
			showConfirmPassword: 'Toon bevestigd wachtwoord',
			errorTitle: 'Aanmelden mislukt',
			creatingAccount: 'Account wordt aangemaakt...',
			continueVerifyEmail: 'Ga verder om e-mail te verifiëren',
			goToLogin: 'Ga naar inloggen',
			submit: 'Meld je aan',
			verifyEmailTitle: 'Verifieer je e-mailadres',
			verifyEmailDescription:
				'Dit helpt ons om je account veilig te houden. We hebben een verificatielink gestuurd naar:',
			codePrompt: 'Voer hieronder je code in:',
			didntReceiveCode: 'Geen code ontvangen?',
			verificationErrorTitle: 'Verificatie mislukt',
			finalizing: 'Afronden',
			verifying: 'Verifiëren'
		}
	},
	onboarding: {
		getStarted: {
			illustrationAlt: 'Curiosity Learning illustratie',
			welcome: 'Welkom bij Curiosity Learning!',
			subtitle: 'Voed je liefde voor leren.',
			joinClub: 'Word lid van een club',
			startClub: 'Start een club',
			iHaveAccount: 'Ik heb al een account'
		},
		joinClub: {
			title: 'Word lid van een club',
			codeTitle: 'Voer je clubcode in',
			description: 'Voer een clubcode in om lid te worden:',
			locationDescription: 'Zoek op locatie om openbare clubs bij jou in de buurt te vinden.',
			haveCode: 'Heb je een clubcode?',
			enterHere: 'Voer hier in',
			locationLabel: 'Waar zoek je een club?',
			locationPlaceholder: 'Stad, plaats of adres',
			locationEmptyFound: 'Geen locaties gevonden.',
			locationEmptyTypeMore: 'Typ minimaal 2 tekens.',
			locationMissingToken:
				'Locatie zoeken is nog niet geconfigureerd. Voeg PUBLIC_MAPBOX_ACCESS_TOKEN toe aan .env.local.',
			locationLookupFailure: 'Kan locatiesuggesties niet ophalen.',
			search: 'Zoeken',
			nearbyTitle: 'Openbare clubs in de buurt',
			nearbyDescription: 'Clublocaties blijven privé. Afstanden zijn bij benadering.',
			noClubsTitle: 'Nog geen openbare clubs in de buurt',
			noClubsDescription:
				'Laat je e-mailadres achter en we laten het weten als er een Curiosity Club in deze buurt opent.',
			emailLabel: 'E-mail',
			emailPlaceholder: 'jij@example.com',
			emailSubmit: 'Houd me op de hoogte',
			interestSuccess: 'Bedankt. We houden je op de hoogte over clubs in deze buurt.',
			interestFailure: 'Kan je e-mailadres nu niet opslaan.',
			startClubCta: 'Start zelf een club',
			noCode: 'Geen code?',
			publicClubs: 'Bekijk openbare clubs bij jou in de buurt.',
			continue: 'Doorgaan',
			checking: 'Controleren...',
			notFound: 'Geen club gevonden met deze code. Controleer de code en probeer het opnieuw.',
			validateFailure: 'Kan deze code nu niet controleren. Probeer het opnieuw.'
		},
		joinClubDetails: {
			loading: 'Clubgegevens laden...',
			invalidTitle: 'Ongeldige clubcode',
			invalidDescription: 'Deze uitnodigingscode is ongeldig of verlopen.',
			enterAnother: 'Voer een andere code in',
			checkingAccountTitle: 'Je account wordt gecontroleerd…',
			checkingAccountDescription:
				'We brengen je terug naar aanmelden zodat je verder kunt gaan vanaf dezelfde stap.',
			defaultDescription:
				'Word lid van deze Curiosity Club om te leren, samen te werken en projecten te bouwen met een lokale leergemeenschap.',
			joinAsLearner: 'Word lid als leerling',
			continuing: 'Bezig met doorgaan...',
			checkingSession: 'Je sessie wordt gecontroleerd. Probeer het opnieuw.',
			continueFailure: 'Kan nu niet doorgaan.'
		},
		startClub: {
			videoFinalizeFailure: 'Het uploaden van de video kon niet worden afgerond.',
			videoUploadFailure: 'Kan video nu niet uploaden.',
			checkingSession: 'Je sessie wordt gecontroleerd. Probeer het opnieuw.',
			submitFailure: 'Kan je aanmelding niet verzenden.',
			title: 'Voeg gegevens voor je aanmelding toe',
			locationLabel: 'Waar wil je een Curiosity Club starten?',
			locationPlaceholder: 'Zoek naar een locatie...',
			locationEmptyFound: 'Geen locaties gevonden.',
			locationEmptyTypeMore: 'Typ minimaal 2 tekens.',
			locationHintEnabled: 'Zoek naar een stad, plaats of adres met Mapbox-geocodering.',
			locationHintMissingToken:
				'Voeg PUBLIC_MAPBOX_ACCESS_TOKEN toe aan .env.local om Mapbox-geocodering en de kaartweergave in te schakelen.',
			locationLookupFailure: 'Kan locatiesuggesties niet ophalen.',
			roleLabel: 'Ik ben een...',
			rolePlaceholder: 'Selecteer een optie',
			aboutLabel: 'Wie ben je?',
			aboutPlaceholder: 'Vertel ons iets over jezelf...',
			aboutHelp:
				'Waarom wil je dit doen? Waarom pas jij hier goed bij? Wat wil je leren? Heb je relevante eerdere ervaringen? Links naar eerdere ervaringen?',
			referralLabel: 'Hoe heb je ons gevonden?',
			referralPlaceholder: 'Selecteer een optie',
			referralOtherLabel: 'Licht toe',
			referralOtherPlaceholder: 'Vertel ons hoe je ons hebt gevonden',
			continue: 'Doorgaan',
			videoTitle: 'Voeg video toe',
			videoPromptTitle: 'Upload een video van 1 minuut waarin je het volgende beantwoordt:',
			videoPromptDescription:
				'Waarom wil je een Curiosity Club starten? Hoe zie je dat een Curiosity Club past binnen jouw gemeenschap?',
			videoUploadTitle: 'Upload een video uit je galerij:',
			uploading: 'Uploaden',
			videoUploading: 'Je video wordt geüpload...',
			videoDropPrompt: 'Sleep een video hierheen of kies er een',
			videoRequirements: 'MP4, MOV, WEBM of M4V tot 100 MB.',
			videoRequired: 'Upload een video voordat je je aanmelding verzendt.',
			videoUploadingStatus: 'Video uploaden...',
			videoUploadedStatus: 'Video geüpload',
			submitting: 'Verzenden...',
			submitApplication: 'Aanmelding verzenden',
			roles: {
				teacher: 'Leraar',
				parent: 'Ouder',
				student: 'Leerling',
				communityOrganizer: 'Gemeenschapsorganisator',
				mentor: 'Mentor',
				other: 'Anders'
			},
			referrals: {
				instagram: 'Instagram',
				linkedin: 'LinkedIn',
				facebook: 'Facebook',
				youtube: 'YouTube',
				xTwitter: 'X (Twitter)',
				friendFamily: 'Vriend of familie',
				schoolTeacher: 'School of leraar',
				eventWorkshop: 'Evenement of workshop',
				other: 'Anders'
			}
		},
		postSignup: {
			restoringTitle: 'Je aanmelding wordt voortgezet',
			restoringDescription:
				'We herstellen je sessie zodat je de verplichte stappen voor gebruikersnaam en pledges kunt afronden.',
			profileTitle: 'Stel je profiel in',
			usernameLabel: 'Gebruikersnaam',
			usernamePlaceholder: 'Kies je gebruikersnaam',
			profileImageLabel: 'Profielafbeelding (optioneel)',
			profilePreviewAlt: 'Profielvoorbeeld',
			uploadingImage: 'Afbeelding uploaden...',
			dropOrChooseImage: 'Sleep of kies een afbeelding',
			imageRequirements: 'PNG, JPG of WEBP tot 10 MB.',
			uploading: 'Uploaden',
			profileImageUploadFailedTitle: 'Kon profielafbeelding niet uploaden',
			profileImageUploadFailedDescription: 'Probeer het opnieuw.',
			usernameRequiredTitle: 'Gebruikersnaam is verplicht',
			saveProfileFailedTitle: 'Kon profielgegevens niet opslaan',
			saveProfileFailedDescription: 'Probeer het opnieuw.',
			pledgesTitle: 'Lees en accepteer onze leerbeloften',
			pledgesDescription:
				'Wij zetten ons in voor een veilige en ondersteunende leeromgeving voor elke leerling. Lees en accepteer deze beloften.',
			pledgesLoading: 'Details van de beloften laden...',
			pledgesEmpty: 'Er zijn nog geen pledge-details beschikbaar.',
			agreeAll: 'Ik heb alle bovenstaande punten gelezen en ga ermee akkoord.',
			confirmationRequiredTitle: 'Bevestiging vereist',
			confirmationRequiredDescription: 'Lees en accepteer alle pledges voordat je verdergaat.',
			finishOnboardingFailedTitle: 'Kon onboarding niet afronden',
			finishOnboardingFailedDescription: 'Probeer het opnieuw.',
			loadPledgesFailedTitle: 'Kon pledges niet laden',
			loadPledgesFailedDescription: 'Probeer het opnieuw.'
		}
	}
} as const;

export default nl;
