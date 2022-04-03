
	  // Import the functions you need from the SDKs you need
	  import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";

	  import { getDatabase, ref, child, get, onValue, set } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-database.js";
	  import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";

	  // TODO: Add SDKs for Firebase products that you want to use
	  // https://firebase.google.com/docs/web/setup#available-libraries

	  // Your web app's Firebase configuration
	  const firebaseConfig = {
	  	apiKey: "AIzaSyAlnze6bJCvcRD72nVGmmc6w0QfRsvtQNU",
	  	authDomain: "metabox-eec95.firebaseapp.com",
	  	databaseURL: "https://metabox-eec95.firebaseio.com",
	  	projectId: "metabox",
	  	storageBucket: "metabox.appspot.com",
	  	messagingSenderId: "990184798969",
	  	appId: "1:990184798969:web:5f98fb43fd515b90e64028"
	  };


		// Initialize Firebase
		const app = initializeApp(firebaseConfig);
		// io.initFirebase(app, {getDatabase, ref, child, get, onValue, set })

		// Once fb is initialized, we want to 
		// * get any updates from the rooms we have subscribed to
		// * send any updates to a room

		io.onRoomUpdate = (roomID) => {

		}

		const auth = getAuth();
		signInAnonymously(auth)
			.then(() => {
			// Signed in..
		})
		.catch((error) => {
			const errorCode = error.code;
			const errorMessage = error.message;
			// ...
		})