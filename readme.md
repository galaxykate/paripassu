# To create your own Pokemon Go:

* Clone the Paripassu github repo to make repo for your group/self (https://github.com/galaxykate/paripassu)
* Host the page with Github pages (or with ngrok)
* Design a game
	- Decide what landmarks you will use and what happens when the user intersects them
	- Consider
		+ Landmarks from the openmaps set (landmarks-natural-nu, landmarks-shop-evanston, landmarks-interesting-evanston)
		+ Randomly-generated landmarks that change each time (or persist)
		+ Custom-made landmarks 
	- Is there a time limit?
	- What does the player get when they get to a goal?
		+ points?
		+ a surprise?
	- Who else is playing? We don't have a social channel in the game, but how can you
	

Things you can modify:
* The Vue gamestate display in pokemon-app.js (search "TODO")
* What is recorded in gamestate
* Any of the InteractiveMap handlers:
	- initializeMap: a good place to set up new landmarks, random, hand-authored, or loaded from JSON data
	- update: do something every update frame, a good place to check if the game is over or time has changed
	- initializeLandmark: add data to every landmark in your game. Are coffee shops worth 10 points?
	- onEnterRange, onExitRange: what to do if the player enters or exits the region around a landmark. Different levels mean you can give different points for proximity
	- featureToStyle: How a landmark is displayed
