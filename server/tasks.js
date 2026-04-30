export const TASKS = [
  {
    id: 'magic-house-3',
    title: 'Magic House',
    category: 'A',
    type: 'magic_house',
    url: '/tasks/ALevelGames/MagicHouse3.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'sudoku-2',
    title: 'Shape Sudoku',
    category: 'A',
    type: 'shape_sudoku',
    url: '/tasks/ALevelGames/Sudoku2.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'organizing-bracelets-3',
    title: 'Organizing Bracelets',
    category: 'A',
    type: 'organizing_bracelets',
    url: '/tasks/ALevelGames/OrganizingBracelets3.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'sorting-branches-3',
    title: 'Sorting Branches',
    category: 'A',
    type: 'generic',
    url: '/tasks/ALevelGames/SortingBranches3.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'bbq-party-2',
    title: 'BBQ Party',
    category: 'A',
    type: 'generic',
    url: '/tasks/ALevelGames/BBQParty2.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'cube-game-1',
    title: 'Cube Game',
    category: 'B',
    type: 'cube_game',
    url: '/tasks/BLevelGames/cubegame1.html',
    maxScore: 100,
    scoring: {
      // decays are used if we don't get a summary payload
      timeDecayPerSecond: 0.05,
      dragDecayPerSecond: 0.1,
      clickDecayPerClick: 0.2,
      weights: { error: 0.5, drag: 0.2, time: 0.2, click: 0.1 }
    }
  },
  {
    id: 'robot-rug',
    title: 'Robot Rug',
    category: 'B',
    type: 'generic',
    url: '/tasks/BLevelGames/Robot%20Rug.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'pick-up-sticks-3',
    title: 'Pick Up Sticks',
    category: 'B',
    type: 'generic',
    url: '/tasks/BLevelGames/PickUpSticks3.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'journey-to-the-hive-3',
    title: 'Journey To The Hive',
    category: 'B',
    type: 'generic',
    url: '/tasks/BLevelGames/JourneyToTheHive3.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'coloring-page-3',
    title: 'Coloring Page',
    category: 'B',
    type: 'generic',
    url: '/tasks/BLevelGames/ColoringPage3.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'online-class-picture-flow',
    title: 'Online Class Picture Flow',
    category: 'C',
    type: 'generic',
    url: '/tasks/CLevelGames/index.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'tug-of-war-2',
    title: 'Tug Of War',
    category: 'C',
    type: 'generic',
    url: '/tasks/CLevelGames/Tug%20Of%20War/TugOfWar2.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'remembering-faces-2',
    title: 'Remembering Faces',
    category: 'C',
    type: 'generic',
    url: '/tasks/CLevelGames/RememberingFaces/RememberingFaces2.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  },
  {
    id: 'burger-recipe-2',
    title: 'Burger Recipe',
    category: 'C',
    type: 'generic',
    url: '/tasks/CLevelGames/BurgerRecipe/BurgerRecipe2.html',
    maxScore: 100,
    scoring: {
      timeDecayPerSecond: 0.05,
      clickDecayPerClick: 0.2
    }
  }
];

