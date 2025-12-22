import { setSchedule } from './db.js';

const update = async () => {
    try {
        console.log('Updating schedule to 22:00 - 18:00...');
        await setSchedule('22:00', '18:00');
        console.log('✅ Schedule updated successfully!');
    } catch (error) {
        console.error('❌ Failed to update schedule:', error);
    }
};

update();
