// Import the functions you need from the SDKs you need
console.log("CONNECTING TO FIREBASE")
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// It's ok for this to be public! Its visible in any web page
const firebaseConfig = {
	apiKey: "AIzaSyDZO5KrCfUsyg3-H25kUAZ_Z6aDv8KZAHA",
	authDomain: "paripassu-e9c1b.firebaseapp.com",
	databaseURL: "https://paripassu-e9c1b-default-rtdb.firebaseio.com",
	projectId: "paripassu-e9c1b",
	storageBucket: "paripassu-e9c1b.appspot.com",
	messagingSenderId: "395560885213",
	appId: "1:395560885213:web:3844e290560d34f46b7434"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);


console.log("CONNECTED TO FIREBASE")
var databaseRef = firebase.database();
room.initFirebaseConnection(databaseRef)

// Subscribing to auth changes
firebase.auth().onAuthStateChanged((user) => {
	if (user) {
		// User is signed in, see docs for a list of available properties
		// https://firebase.google.com/docs/reference/js/firebase.User
		var uid = user.uid;
		console.log(`Firebase: ${uid} user just signed in`)
		room.setFirebaseAuthUser(uid, user)
		// ...
	} else {
		// User is signed out
		// ...
	}
});

// Attempting authenticate anonymously
firebase.auth().signInAnonymously()
.then(() => {
	console.log("Firebase auth: Signed in anonynmously")
})
.catch((error) => {
	var errorCode = error.code;
	var errorMessage = error.message;
	// ...
	console.log(error)
});
		  
