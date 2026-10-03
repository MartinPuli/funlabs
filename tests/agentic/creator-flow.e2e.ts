import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';

test.setup('sign in as the creator', { sessions: ['creator'] }, async ({ app, screen, session, browser }) => {
  const creator = credentials.user('creator');
  await app.open('/sign-in');
  await screen.getByLabel('Email').fill(creator.username);
  await screen.getByLabel('Password').fill(creator.password);
  await screen.getByRole('button', 'Sign in').tap();
  await expect(browser).toHaveURL('/lab');
  await session.save('creator');
});

// An agent drives the real interface from goals; locators check the exact results.
test('an agent creates the example study, publishes it and creates invite links', { session: 'creator' }, async ({ app, agent, screen, browser }) => {
  await browser.onDialog('accept');
  await app.open('/lab');

  await agent.act('Create the example study');
  await agent.assert('a study titled "Gravity Room: clarity of the opening" is open and its status is Draft');

  await agent.act('Publish the study');
  // The success toast disappears when the page moves to the next step, so check durable state.
  await expect(screen.getByRole('heading', 'Invite people')).toBeVisible();

  await agent.act('Create 2 invite links');
  await expect(screen.getByText(/\/t\/flt_/).first()).toBeVisible();
  await agent.assert('two invite links are listed and none of them has been accepted yet');
});
